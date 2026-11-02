import hashlib
import hmac
import json
import os
import secrets
import time
from collections import defaultdict, deque
from pathlib import Path
from urllib.parse import quote, urlencode
from typing import Dict, List, Literal, Optional

import qrcode
import qrcode.image.svg
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import db, money

# A split is open for TTL from creation (fixed, use doesn't extend it), then read-only for GRACE
# so people can download the summary, then deleted.
TTL = 48 * 3600
GRACE = 24 * 3600
STATIC = Path(__file__).parent.parent / "static"
UPI_RE = r"^[a-zA-Z0-9._-]{1,256}@[a-zA-Z]{2,64}$"
# (limit, window seconds) per client IP
CREATE_LIMIT = (10, 3600)
WRITE_LIMIT = (60, 60)
LOGIN_LIMIT = (10, 900)  # per split, so guessing the admin password is slow from any number of IPs

# UPI IDs are encrypted at rest. Set UPI_KEY in production (Fernet.generate_key()).
if not os.environ.get("UPI_KEY"):
    print("WARNING: UPI_KEY not set, using an insecure dev key")
FERNET = Fernet(os.environ.get("UPI_KEY", "ZGV2LWtleS1kby1ub3QtdXNlLWluLXByb2R1Y3Rpb24="))

# Signs admin session tokens. Set SECRET_KEY in production.
if not os.environ.get("SECRET_KEY"):
    print("WARNING: SECRET_KEY not set, using an insecure dev key")
SECRET_KEY = os.environ.get("SECRET_KEY", "dev-secret-do-not-use-in-production").encode()


def enc(v):
    return FERNET.encrypt(v.encode()).decode() if v else None


def dec(v):
    return FERNET.decrypt(v.encode()).decode() if v else None



db.init()  # runs once per cold start on Vercel
app = FastAPI(docs_url=None, redoc_url=None)
app.mount("/static", StaticFiles(directory=STATIC), name="static")


# ponytail: in-memory per-process limiter, move to Redis/DB if running more than one instance
HITS = defaultdict(deque)


def rate_limited(key, limit, window):
    if len(HITS) > 10000:
        HITS.clear()
    hits, t = HITS[key], time.monotonic()
    while hits and hits[0] <= t - window:
        hits.popleft()
    if len(hits) >= limit:
        return True
    hits.append(t)
    return False


@app.middleware("http")
async def security_headers(request, call_next):
    # Behind Vercel the socket peer is Vercel's proxy; it sets x-real-ip to the visitor's address.
    ip = (os.environ.get("VERCEL") and request.headers.get("x-real-ip")) or (request.client.host if request.client else "?")
    if request.method != "GET" and request.url.path.startswith("/api/"):
        creating = request.method == "POST" and request.url.path == "/api/splits"
        kind, limit = ("create", CREATE_LIMIT) if creating else ("write", WRITE_LIMIT)
        if rate_limited((kind, ip), *limit):
            resp = JSONResponse({"detail": "Too many requests. Wait a bit and try again."}, status_code=429)
        else:
            resp = await call_next(request)
    else:
        resp = await call_next(request)
    resp.headers.update({
        "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        "X-Frame-Options": "DENY",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Strict-Transport-Security": "max-age=31536000",
    })
    if request.url.path not in ("/", "/static/style.css"):  # only the landing page is indexable
        resp.headers["X-Robots-Tag"] = "noindex"
    return resp


# ---------- pages ----------

@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


@app.get("/new")
def new():
    return FileResponse(STATIC / "new.html")


@app.get("/g/{slug}")
def split_page(slug: str):
    return FileResponse(STATIC / "split.html")


# ---------- models ----------

class MemberIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    upi_id: Optional[str] = Field(default=None, pattern=UPI_RE)


class SplitIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    members: List[MemberIn] = Field(min_length=1, max_length=50)  # the first one is the creator, who becomes admin
    admin_password: str = Field(min_length=4, max_length=100)
    website: str = ""  # honeypot, humans never see it


class LoginIn(BaseModel):
    password: str = Field(max_length=100)


class ExpenseIn(BaseModel):
    paid_by: int
    amount_paise: int = Field(gt=0, le=10**10)
    description: str = Field(min_length=1, max_length=100)
    split: Literal["equal", "exact"]
    participants: List[int] = []  # equal
    shares: Dict[int, int] = {}  # exact: member_id -> paise
    version: Optional[int] = None  # required on edit
    kind: Literal["expense", "payment"] = "expense"  # set on create only


# ---------- helpers ----------

def now():
    return int(time.time())


def scrypt(pw, salt):
    return Scrypt(salt=salt, length=32, n=2**14, r=8, p=1).derive(pw.encode()).hex()


def hash_password(pw):
    salt = os.urandom(16)
    return salt.hex() + "$" + scrypt(pw, salt)


def check_password(pw, stored):
    salt, h = stored.split("$")
    return hmac.compare_digest(scrypt(pw, bytes.fromhex(salt)), h)


def admin_token(split_id, pw_hash):
    # Stateless admin session. Tied to the password hash, so changing the password logs everyone out.
    return hmac.new(SECRET_KEY, f"{split_id}:{pw_hash}".encode(), hashlib.sha256).hexdigest()


def load_split(con, slug, ended_ok=False):
    s = con.execute("SELECT * FROM splits WHERE slug = ?", (slug,)).fetchone()
    if not s or s["expires_at"] + GRACE < now():
        raise HTTPException(404, "Split not found or expired")
    if not ended_ok and s["expires_at"] < now():
        raise HTTPException(410, "This split has ended, so it can't be changed. Start a new one for new expenses.")
    return s


def require_admin(s, token):
    if not token or not hmac.compare_digest(token, admin_token(s["id"], s["admin_pw_hash"])):
        raise HTTPException(403, "Admin password required")


def member_ids(con, split_id):
    return [r["id"] for r in con.execute("SELECT id FROM members WHERE split_id = ? ORDER BY id", (split_id,))]


def compute_shares(members, e):
    if e.paid_by not in members:
        raise HTTPException(400, "Payer is not a member")
    if e.split == "equal":
        ids = sorted(set(e.participants))
        if not ids or not set(ids) <= set(members):
            raise HTTPException(400, "Pick at least one valid member to split between")
        return money.split_equal(e.amount_paise, ids)
    shares = {m: s for m, s in e.shares.items() if s}
    if not shares or not set(shares) <= set(members) or any(s < 0 for s in shares.values()):
        raise HTTPException(400, "Invalid shares")
    if sum(shares.values()) != e.amount_paise:
        raise HTTPException(400, "Shares must add up to the total")
    return shares


def log(con, split_id, action, expense_id, details):
    con.execute(
        "INSERT INTO activity (split_id, action, expense_id, details, created_at) VALUES (?, ?, ?, ?, ?)",
        (split_id, action, expense_id, json.dumps(details), now()),
    )


def write_shares(con, expense_id, shares):
    con.execute("DELETE FROM shares WHERE expense_id = ?", (expense_id,))
    con.executemany(
        "INSERT INTO shares (expense_id, member_id, share_paise) VALUES (?, ?, ?)",
        [(expense_id, m, s) for m, s in shares.items()],
    )


def snapshot(con, e):
    shares = {r["member_id"]: r["share_paise"] for r in con.execute("SELECT * FROM shares WHERE expense_id = ?", (e["id"],))}
    return {"paid_by": e["paid_by"], "amount_paise": e["amount_paise"], "description": e["description"], "shares": shares}


def get_expense(con, split_id, expense_id):
    e = con.execute("SELECT * FROM expenses WHERE id = ? AND split_id = ?", (expense_id, split_id)).fetchone()
    if not e:
        raise HTTPException(404, "Expense not found")
    return e


def create_split(con, body, slug=None):
    slug = slug or secrets.token_urlsafe(16)  # 128-bit, unguessable
    pw_hash = hash_password(body.admin_password)
    t = now()
    sid = con.execute(
        "INSERT INTO splits (slug, name, admin_pw_hash, last_activity_at, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
        (slug, body.name, pw_hash, t, t + TTL, t),
    ).fetchone()["id"]
    ids = [con.execute("INSERT INTO members (split_id, name, upi_id) VALUES (?, ?, ?) RETURNING id",
                       (sid, m.name, enc(m.upi_id))).fetchone()["id"] for m in body.members]
    con.execute("UPDATE splits SET admin_member_id = ? WHERE id = ?", (ids[0], sid))
    log(con, sid, "created", None, {"name": body.name})
    return slug, admin_token(sid, pw_hash), sid, ids[0]


# ---------- API ----------

@app.post("/api/splits")
def create(body: SplitIn, con=Depends(db.get_db)):
    if body.website:
        raise HTTPException(400, "Bad request")
    names = [m.name.strip().lower() for m in body.members]
    if len(set(names)) != len(names):
        raise HTTPException(400, "Member names must be unique")
    slug, token, _, admin_id = create_split(con, body)
    con.commit()
    return {"slug": slug, "admin_token": token, "admin_id": admin_id}


@app.post("/api/splits/{slug}/admin-login")
def admin_login(slug: str, body: LoginIn, con=Depends(db.get_db)):
    s = load_split(con, slug)
    if rate_limited(("login", slug), *LOGIN_LIMIT):
        raise HTTPException(429, "Too many attempts. Try again in 15 minutes.")
    if not check_password(body.password, s["admin_pw_hash"]):
        raise HTTPException(401, "Wrong password")
    return {"admin_token": admin_token(s["id"], s["admin_pw_hash"])}


@app.get("/api/splits/{slug}")
def read(slug: str, con=Depends(db.get_db)):
    s = load_split(con, slug, ended_ok=True)
    ended = s["expires_at"] < now()
    # Nobody pays through an ended split, so its UPI IDs stop being shown.
    members = [{**dict(r), "upi_id": None if ended else dec(r["upi_id"])} for r in con.execute(
        "SELECT id, name, upi_id FROM members WHERE split_id = ? ORDER BY id", (s["id"],))]
    expenses = []
    for e in con.execute("SELECT * FROM expenses WHERE split_id = ? ORDER BY created_at DESC, id DESC", (s["id"],)):
        shares = {r["member_id"]: r["share_paise"] for r in con.execute("SELECT * FROM shares WHERE expense_id = ?", (e["id"],))}
        expenses.append({**{k: e[k] for k in ("id", "paid_by", "amount_paise", "description", "kind", "version", "created_at")},
                         "deleted": bool(e["deleted"]), "shares": shares})
    live = [(e["paid_by"], e["amount_paise"], e["shares"]) for e in expenses if not e["deleted"]]
    bal = money.balances([m["id"] for m in members], live)
    activity = [{**dict(r), "details": json.loads(r["details"])} for r in con.execute(
        "SELECT id, action, expense_id, details, created_at FROM activity WHERE split_id = ? ORDER BY id DESC LIMIT 50", (s["id"],))]
    return {
        "name": s["name"],
        "expires_at": s["expires_at"],
        "deletes_at": s["expires_at"] + GRACE,
        "ended": ended,
        "admin_id": s["admin_member_id"],
        "members": members,
        "expenses": expenses,
        "balances": bal,
        "settlement": [{"from": d, "to": c, "amount_paise": a} for d, c, a in money.settle(bal)],
        "activity": activity,
    }


def upi_link(upi_id, name, amount_paise, note):
    # Same format as upiLink() in split.js. %20 not +, some UPI apps don't decode +.
    return "upi://pay?" + urlencode({
        "pa": upi_id, "pn": name, "am": f"{amount_paise // 100}.{amount_paise % 100:02d}", "cu": "INR", "tn": note[:50],
    }, safe="@", quote_via=quote)


@app.get("/api/splits/{slug}/qr")
def qr(slug: str, to: int, amount: int, con=Depends(db.get_db)):
    """UPI QR for paying a member of this split. Only encodes this split's own UPI IDs."""
    s = load_split(con, slug)
    m = con.execute("SELECT * FROM members WHERE id = ? AND split_id = ?", (to, s["id"])).fetchone()
    if not m or not m["upi_id"] or not 0 < amount <= 10**10:
        raise HTTPException(404, "No UPI ID for this member")
    img = qrcode.make(upi_link(dec(m["upi_id"]), m["name"], amount, s["name"]),
                      image_factory=qrcode.image.svg.SvgPathImage, border=2)
    return Response(img.to_string(encoding="unicode"), media_type="image/svg+xml",
                    headers={"Cache-Control": "private, max-age=300"})


@app.post("/api/splits/{slug}/expenses")
def add_expense(slug: str, body: ExpenseIn, con=Depends(db.get_db)):
    s = load_split(con, slug)
    shares = compute_shares(member_ids(con, s["id"]), body)
    if body.kind == "payment" and (len(shares) != 1 or body.paid_by in shares):
        raise HTTPException(400, "A payment goes from one member to one other member")
    eid = con.execute(
        "INSERT INTO expenses (split_id, paid_by, amount_paise, description, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
        (s["id"], body.paid_by, body.amount_paise, body.description, body.kind, now(), now()),
    ).fetchone()["id"]
    write_shares(con, eid, shares)
    log(con, s["id"], "added", eid, {"description": body.description, "amount_paise": body.amount_paise})
    con.commit()
    return {"id": eid}


@app.put("/api/splits/{slug}/expenses/{expense_id}")
def edit_expense(slug: str, expense_id: int, body: ExpenseIn, con=Depends(db.get_db)):
    s = load_split(con, slug)
    prev = snapshot(con, get_expense(con, s["id"], expense_id))
    shares = compute_shares(member_ids(con, s["id"]), body)
    # Optimistic lock: only update if nobody changed it since the client loaded it.
    cur = con.execute(
        "UPDATE expenses SET paid_by = ?, amount_paise = ?, description = ?, version = version + 1, updated_at = ? "
        "WHERE id = ? AND version = ? AND deleted = 0",
        (body.paid_by, body.amount_paise, body.description, now(), expense_id, body.version),
    )
    if cur.rowcount == 0:
        raise HTTPException(409, "This expense changed since you opened it. Reload and try again.")
    write_shares(con, expense_id, shares)
    log(con, s["id"], "edited", expense_id,
        {"description": body.description, "amount_paise": body.amount_paise, "prev": prev})
    con.commit()
    return {"ok": True}


@app.delete("/api/splits/{slug}/expenses/{expense_id}")
def delete_expense(slug: str, expense_id: int, con=Depends(db.get_db)):
    s = load_split(con, slug)
    set_deleted(con, s["id"], get_expense(con, s["id"], expense_id), True)
    con.commit()
    return {"ok": True}


def set_deleted(con, split_id, e, deleted):
    con.execute("UPDATE expenses SET deleted = ?, version = version + 1 WHERE id = ?", (int(deleted), e["id"]))
    log(con, split_id, "deleted" if deleted else "restored", e["id"],
        {"description": e["description"], "amount_paise": e["amount_paise"]})


@app.post("/api/splits/{slug}/activity/{activity_id}/undo")
def undo(slug: str, activity_id: int, con=Depends(db.get_db)):
    """Undo the latest change to an expense. The undo is itself logged, so it can be undone too."""
    s = load_split(con, slug)
    a = con.execute("SELECT * FROM activity WHERE id = ? AND split_id = ?", (activity_id, s["id"])).fetchone()
    if not a or a["expense_id"] is None:
        raise HTTPException(404, "Nothing to undo")
    latest = con.execute("SELECT MAX(id) AS latest FROM activity WHERE expense_id = ?", (a["expense_id"],)).fetchone()["latest"]
    if latest != a["id"]:
        raise HTTPException(409, "Only the latest change to an expense can be undone. Reload and try again.")
    e = get_expense(con, s["id"], a["expense_id"])
    if a["action"] in ("added", "restored"):
        set_deleted(con, s["id"], e, True)
    elif a["action"] == "deleted":
        set_deleted(con, s["id"], e, False)
    elif a["action"] == "edited":
        prev = json.loads(a["details"])["prev"]
        shares = {int(m): p for m, p in prev["shares"].items()}
        if not {prev["paid_by"], *shares} <= set(member_ids(con, s["id"])):
            raise HTTPException(409, "Can't undo: a member in that version was removed")
        current = snapshot(con, e)
        con.execute(
            "UPDATE expenses SET paid_by = ?, amount_paise = ?, description = ?, version = version + 1, updated_at = ? WHERE id = ?",
            (prev["paid_by"], prev["amount_paise"], prev["description"], now(), e["id"]),
        )
        write_shares(con, e["id"], shares)
        log(con, s["id"], "edited", e["id"],
            {"description": prev["description"], "amount_paise": prev["amount_paise"], "prev": current})
    con.commit()
    return {"ok": True}


@app.post("/api/splits/{slug}/members")
def add_member(slug: str, body: MemberIn, con=Depends(db.get_db)):
    """Anyone with the link can add themselves (or a friend), like anyone can add an expense."""
    s = load_split(con, slug)
    existing = [r["name"].strip().lower() for r in con.execute("SELECT name FROM members WHERE split_id = ?", (s["id"],))]
    if body.name.strip().lower() in existing:
        raise HTTPException(400, "That name is already in this split. Pick it from the list instead.")
    if len(existing) >= 50:
        raise HTTPException(400, "This split is full (50 members)")
    mid = con.execute("INSERT INTO members (split_id, name, upi_id) VALUES (?, ?, ?) RETURNING id",
                      (s["id"], body.name, enc(body.upi_id))).fetchone()["id"]
    log(con, s["id"], "member_added", None, {"name": body.name})
    con.commit()
    return {"id": mid}


class UpiIn(BaseModel):
    upi_id: Optional[str] = Field(default=None, pattern=UPI_RE)


@app.put("/api/splits/{slug}/members/{member_id}/upi")
def set_upi(slug: str, member_id: int, body: UpiIn, x_admin_token: Optional[str] = Header(None), con=Depends(db.get_db)):
    """Members fill in their own UPI ID once. Changing an existing one needs the admin,
    otherwise anyone with the link could swap in their own ID and collect someone else's payments."""
    s = load_split(con, slug)
    m = con.execute("SELECT * FROM members WHERE id = ? AND split_id = ?", (member_id, s["id"])).fetchone()
    if not m:
        raise HTTPException(404, "Member not found")
    if m["upi_id"]:
        require_admin(s, x_admin_token)
    con.execute("UPDATE members SET upi_id = ? WHERE id = ?", (enc(body.upi_id), member_id))
    log(con, s["id"], "upi_set", None, {"name": m["name"]})
    con.commit()
    return {"ok": True}


@app.delete("/api/splits/{slug}/members/{member_id}")
def remove_member(slug: str, member_id: int, x_admin_token: Optional[str] = Header(None), con=Depends(db.get_db)):
    s = load_split(con, slug)
    require_admin(s, x_admin_token)
    m = con.execute("SELECT * FROM members WHERE id = ? AND split_id = ?", (member_id, s["id"])).fetchone()
    if not m:
        raise HTTPException(404, "Member not found")
    if member_id == s["admin_member_id"]:
        raise HTTPException(400, "The admin can't be removed")
    used = "SELECT id FROM expenses WHERE (paid_by = ? OR id IN (SELECT expense_id FROM shares WHERE member_id = ?))"
    if con.execute(used + " AND deleted = 0", (member_id, member_id)).fetchone():
        raise HTTPException(400, f"{m['name']} is in some expenses. Edit or delete those first.")
    con.execute(f"DELETE FROM expenses WHERE id IN ({used} AND deleted = 1)", (member_id, member_id))
    con.execute("DELETE FROM members WHERE id = ?", (member_id,))
    log(con, s["id"], "member_removed", None, {"name": m["name"]})
    con.commit()
    return {"ok": True}


@app.delete("/api/splits/{slug}")
def delete_split(slug: str, x_admin_token: Optional[str] = Header(None), con=Depends(db.get_db)):
    s = load_split(con, slug)
    require_admin(s, x_admin_token)
    con.execute("DELETE FROM splits WHERE id = ?", (s["id"],))
    con.commit()
    return {"ok": True}


@app.api_route("/cron/cleanup", methods=["GET", "POST"])
def cleanup(x_cron_secret: Optional[str] = Header(None), authorization: Optional[str] = Header(None),
            con=Depends(db.get_db)):
    # Vercel Cron calls this daily with GET and "Authorization: Bearer $CRON_SECRET".
    secret = os.environ.get("CRON_SECRET")
    given = x_cron_secret or (authorization or "").removeprefix("Bearer ")
    if not secret or not given or not hmac.compare_digest(secret, given):
        raise HTTPException(403)
    n = con.execute("DELETE FROM splits WHERE expires_at < ?", (now() - GRACE,)).rowcount
    con.commit()
    return {"deleted": n}

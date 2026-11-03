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
MAX_MEMBERS = 50
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
        creating = request.method == "POST" and request.url.path in ("/api/splits", "/api/demo")
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
    # Pages and scripts revalidate every load (a cheap 304 when unchanged): a cached old common.js next to a
    # new split.js threw on picking a name and left "Who are you?" stuck.
    resp.headers.setdefault("Cache-Control", "no-cache")
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
    members: List[MemberIn] = Field(min_length=1, max_length=MAX_MEMBERS)  # the creator (admin) first, the rest join from the link
    size: Optional[int] = Field(default=None, ge=1, le=MAX_MEMBERS)  # headcount: the split never holds more people
    # Set: password protected, the admin uses this and everyone else creates their own.
    # Unset: no passwords at all, and whoever picks the admin's name is the admin.
    admin_password: Optional[str] = Field(default=None, min_length=4, max_length=100)
    website: str = ""  # honeypot, humans never see it


class JoinIn(MemberIn):
    password: Optional[str] = Field(default=None, min_length=4, max_length=100)  # protected splits


class EnterIn(BaseModel):
    password: str = Field(default="", max_length=100)


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
    # Stateless session for the admin, or for any member of a protected split (their own password hash).
    # Tied to the hash, so a new password logs the old sessions out.
    return hmac.new(SECRET_KEY, f"{split_id}:{pw_hash}".encode(), hashlib.sha256).hexdigest()


def load_split(con, slug, ended_ok=False):
    s = con.execute("SELECT * FROM splits WHERE slug = ?", (slug,)).fetchone()
    if not s or s["expires_at"] + GRACE < now():
        raise HTTPException(404, "Tab not found or expired")
    if not ended_ok and s["expires_at"] < now():
        raise HTTPException(410, "This tab is closed, so it can't be changed. Open a new one for new expenses.")
    return s


def require_admin(s, token):
    if not s["admin_pw_hash"]:  # a split without passwords: whoever picked the admin's name is the admin
        return
    if not token or not hmac.compare_digest(token, admin_token(s["id"], s["admin_pw_hash"])):
        raise HTTPException(403, "Admin password required")


def member_auth(con, s, token):
    """(protected, member_id). A split is password protected when its admin has a member password.
    member_id is whoever the token belongs to, or None."""
    rows = con.execute("SELECT id, pw_hash FROM members WHERE split_id = ? AND pw_hash IS NOT NULL", (s["id"],)).fetchall()
    who = next((r["id"] for r in rows if token and hmac.compare_digest(token, admin_token(s["id"], r["pw_hash"]))), None)
    return any(r["id"] == s["admin_member_id"] for r in rows), who


def require_member(con, s, token):
    """Changes to a protected split need a member's session, from their password."""
    protected, who = member_auth(con, s, token)
    if protected and who is None:
        raise HTTPException(401, "Enter your password again: tap your name at the top.")


def unique_name(con, split_id, name):
    if name.strip().lower() in [r["name"].strip().lower() for r in con.execute("SELECT name FROM members WHERE split_id = ?", (split_id,))]:
        raise HTTPException(400, "That name is already in this tab. Pick it from the list instead.")


def count(con, key):
    con.execute("INSERT INTO stats (key, value) VALUES (?, 1) ON CONFLICT (key) DO UPDATE SET value = stats.value + 1", (key,))


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


def create_split(con, body, name="Quick tab"):
    slug = secrets.token_urlsafe(16)  # 128-bit, unguessable
    pw_hash = hash_password(body.admin_password) if body.admin_password else ""
    t = now()
    sid = con.execute(
        "INSERT INTO splits (slug, name, admin_pw_hash, last_activity_at, expires_at, created_at, capacity) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
        (slug, name, pw_hash, t, t + TTL, t, body.size),
    ).fetchone()["id"]
    ids = [con.execute("INSERT INTO members (split_id, name, upi_id) VALUES (?, ?, ?) RETURNING id",
                       (sid, m.name, enc(m.upi_id))).fetchone()["id"] for m in body.members]
    if pw_hash:  # the admin password is also the admin's own member password
        con.execute("UPDATE members SET pw_hash = ? WHERE id = ?", (pw_hash, ids[0]))
    con.execute("UPDATE splits SET admin_member_id = ? WHERE id = ?", (ids[0], sid))
    log(con, sid, "created", None, {"name": name})
    return slug, admin_token(sid, pw_hash), sid, ids[0]


# ---------- API ----------

@app.post("/api/splits")
def create(body: SplitIn, con=Depends(db.get_db)):
    if body.website:
        raise HTTPException(400, "Bad request")
    names = [m.name.strip().lower() for m in body.members]
    if len(set(names)) != len(names):
        raise HTTPException(400, "Member names must be unique")
    if body.size and body.size < len(body.members):
        raise HTTPException(400, "More names than people")
    slug, token, _, admin_id = create_split(con, body)
    count(con, "splits")
    con.commit()
    return {"slug": slug, "admin_token": token, "admin_id": admin_id}


@app.post("/api/demo")
def demo(con=Depends(db.get_db)):
    """A fresh, filled-in split for someone who just wants to look around. Same lifetime as any split.
    Guest ends up owing, so the Pay flow is there to try."""
    # @quicktab isn't a real UPI handle, so a demo Pay can never reach a real account.
    body = SplitIn(members=[
        MemberIn(name="Guest", upi_id="guest@quicktab"), MemberIn(name="Riya", upi_id="riya@quicktab"),
        MemberIn(name="Kabir", upi_id="kabir@quicktab"), MemberIn(name="Aman", upi_id="aman@quicktab")])
    slug, token, sid, _ = create_split(con, body, "Quick tab (demo)")
    count(con, "demos")
    con.commit()
    everyone = me, riya, kabir, aman = member_ids(con, sid)
    for e in [
        ExpenseIn(paid_by=riya, amount_paise=1200000, description="Villa, 2 nights", split="equal", participants=list(everyone)),
        ExpenseIn(paid_by=me, amount_paise=320000, description="Dinner at the shack", split="equal", participants=list(everyone)),
        ExpenseIn(paid_by=kabir, amount_paise=180000, description="Scooter rentals", split="equal", participants=[me, kabir, aman]),
        ExpenseIn(paid_by=aman, amount_paise=600000, description="Scuba diving", split="exact", shares={riya: 300000, aman: 300000}),
        ExpenseIn(paid_by=aman, amount_paise=100000, description="Aman paid Riya · Cash", split="exact", shares={riya: 100000}, kind="payment"),
    ]:
        add_expense(slug, e, x_member_token=None, con=con)
    return {"slug": slug, "admin_token": token, "admin_id": me}


@app.post("/api/splits/{slug}/admin-login")
def admin_login(slug: str, body: LoginIn, con=Depends(db.get_db)):
    s = load_split(con, slug)
    if rate_limited(("login", slug), *LOGIN_LIMIT):
        raise HTTPException(429, "Too many attempts. Try again in 15 minutes.")
    if not s["admin_pw_hash"] or not check_password(body.password, s["admin_pw_hash"]):
        raise HTTPException(401, "Wrong password")
    return {"admin_token": admin_token(s["id"], s["admin_pw_hash"])}


@app.get("/api/splits/{slug}")
def read(slug: str, con=Depends(db.get_db)):
    s = load_split(con, slug, ended_ok=True)
    ended = s["expires_at"] < now()
    # Nobody pays through an ended split, so its UPI IDs stop being shown.
    rows = con.execute("SELECT * FROM members WHERE split_id = ? ORDER BY id", (s["id"],)).fetchall()
    members = [{"id": r["id"], "name": r["name"], "upi_id": None if ended else dec(r["upi_id"]),
                "has_password": r["pw_hash"] is not None} for r in rows]
    protected = any(m["has_password"] for m in members if m["id"] == s["admin_member_id"])
    # Every share in the split in one query, not one query per expense.
    shares = defaultdict(dict)
    for r in con.execute("SELECT sh.expense_id, sh.member_id, sh.share_paise FROM shares sh "
                         "JOIN expenses e ON e.id = sh.expense_id WHERE e.split_id = ?", (s["id"],)):
        shares[r["expense_id"]][r["member_id"]] = r["share_paise"]
    expenses = []
    for e in con.execute("SELECT * FROM expenses WHERE split_id = ? ORDER BY created_at DESC, id DESC", (s["id"],)):
        expenses.append({**{k: e[k] for k in ("id", "paid_by", "amount_paise", "description", "kind", "version", "created_at")},
                         "deleted": bool(e["deleted"]), "shares": shares[e["id"]]})
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
        "protected": protected,
        # Splits from before per-member passwords: the admin still unlocks with the admin password.
        "admin_login": not protected and bool(s["admin_pw_hash"]),
        "open_admin": not s["admin_pw_hash"],
        "capacity": s["capacity"] or MAX_MEMBERS,  # no passwords: picking the admin's name makes you the admin
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
def add_expense(slug: str, body: ExpenseIn, x_member_token: Optional[str] = Header(None), con=Depends(db.get_db)):
    s = load_split(con, slug)
    require_member(con, s, x_member_token)
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
def edit_expense(slug: str, expense_id: int, body: ExpenseIn, x_member_token: Optional[str] = Header(None), con=Depends(db.get_db)):
    s = load_split(con, slug)
    require_member(con, s, x_member_token)
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
def delete_expense(slug: str, expense_id: int, x_member_token: Optional[str] = Header(None), con=Depends(db.get_db)):
    s = load_split(con, slug)
    require_member(con, s, x_member_token)
    set_deleted(con, s["id"], get_expense(con, s["id"], expense_id), True)
    con.commit()
    return {"ok": True}


def set_deleted(con, split_id, e, deleted):
    con.execute("UPDATE expenses SET deleted = ?, version = version + 1 WHERE id = ?", (int(deleted), e["id"]))
    log(con, split_id, "deleted" if deleted else "restored", e["id"],
        {"description": e["description"], "amount_paise": e["amount_paise"]})


@app.post("/api/splits/{slug}/activity/{activity_id}/undo")
def undo(slug: str, activity_id: int, x_member_token: Optional[str] = Header(None), con=Depends(db.get_db)):
    """Undo the latest change to an expense. The undo is itself logged, so it can be undone too."""
    s = load_split(con, slug)
    require_member(con, s, x_member_token)
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
def add_member(slug: str, body: JoinIn, x_member_token: Optional[str] = Header(None), con=Depends(db.get_db)):
    """Anyone with the link can add themselves (or a friend), like anyone can add an expense.
    In a protected split, joining yourself means picking a password. A member adding a friend doesn't:
    the friend creates theirs when they first pick their name."""
    s = load_split(con, slug)
    unique_name(con, s["id"], body.name)
    # The headcount is a hard cap, for the admin too: someone has to be removed before anyone new comes in.
    cap = s["capacity"] or MAX_MEMBERS
    if len(member_ids(con, s["id"])) >= cap:
        raise HTTPException(400, f"This tab is full ({cap} people). The admin has to remove someone first.")
    protected, who = member_auth(con, s, x_member_token)
    pw_hash = None
    if protected and who is None:
        if not body.password:
            raise HTTPException(400, "Pick a password, at least 4 characters")
        pw_hash = hash_password(body.password)
    mid = con.execute("INSERT INTO members (split_id, name, upi_id, pw_hash) VALUES (?, ?, ?, ?) RETURNING id",
                      (s["id"], body.name, enc(body.upi_id), pw_hash)).fetchone()["id"]
    log(con, s["id"], "member_added", None, {"name": body.name})
    con.commit()
    return {"id": mid, "token": pw_hash and admin_token(s["id"], pw_hash)}


@app.post("/api/splits/{slug}/members/{member_id}/enter")
def enter(slug: str, member_id: int, body: EnterIn, con=Depends(db.get_db)):
    """Picking your name at "Who are you?" in a protected split: the first pick creates your password,
    later picks check it. Returns a session token."""
    s = load_split(con, slug)
    m = con.execute("SELECT * FROM members WHERE id = ? AND split_id = ?", (member_id, s["id"])).fetchone()
    if not m:
        raise HTTPException(404, "Member not found")
    if rate_limited(("login", slug, member_id), *LOGIN_LIMIT):
        raise HTTPException(429, "Too many attempts. Try again in 15 minutes.")
    if not member_auth(con, s, None)[0]:
        raise HTTPException(400, "This tab has no passwords")
    pw_hash = m["pw_hash"]
    if pw_hash and not check_password(body.password, pw_hash):
        raise HTTPException(401, "Wrong password")
    if not pw_hash:
        if len(body.password) < 4:
            raise HTTPException(400, "Pick a password, at least 4 characters")
        pw_hash = hash_password(body.password)
        con.execute("UPDATE members SET pw_hash = ? WHERE id = ?", (pw_hash, member_id))
        con.commit()
    token = admin_token(s["id"], pw_hash)
    return {"token": token, "admin_token": token if member_id == s["admin_member_id"] else None}


class UpiIn(BaseModel):
    upi_id: Optional[str] = Field(default=None, pattern=UPI_RE)


@app.put("/api/splits/{slug}/members/{member_id}/upi")
def set_upi(slug: str, member_id: int, body: UpiIn, x_admin_token: Optional[str] = Header(None),
            x_member_token: Optional[str] = Header(None), con=Depends(db.get_db)):
    """Members fill in their own UPI ID once. Changing an existing one needs the admin,
    otherwise anyone with the link could swap in their own ID and collect someone else's payments.
    In a protected split only that member (or the admin) can set it, any time."""
    s = load_split(con, slug)
    m = con.execute("SELECT * FROM members WHERE id = ? AND split_id = ?", (member_id, s["id"])).fetchone()
    if not m:
        raise HTTPException(404, "Member not found")
    protected, who = member_auth(con, s, x_member_token)
    if (who != member_id) if protected else m["upi_id"]:
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

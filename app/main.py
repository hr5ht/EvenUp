import hashlib
import hmac
import json
import os
import secrets
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Dict, List, Literal, Optional

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import db, money

TTL = 48 * 3600
DEMO = "demo"
STATIC = Path(__file__).parent.parent / "static"
UPI_RE = r"^[a-zA-Z0-9._-]{1,256}@[a-zA-Z]{2,64}$"



@asynccontextmanager
async def lifespan(app):
    db.init()
    con = db.connect()
    seed_demo(con)
    con.commit()
    con.close()
    yield


app = FastAPI(docs_url=None, redoc_url=None, lifespan=lifespan)
app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.middleware("http")
async def security_headers(request, call_next):
    resp = await call_next(request)
    resp.headers.update({
        "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        "X-Frame-Options": "DENY",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Strict-Transport-Security": "max-age=31536000",
        "X-Robots-Tag": "noindex",
    })
    return resp


# ---------- pages ----------

@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


@app.get("/g/{slug}")
def split_page(slug: str):
    return FileResponse(STATIC / "split.html")


@app.get("/demo")
def demo():
    return RedirectResponse(f"/g/{DEMO}")


# ---------- models ----------

class MemberIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    upi_id: Optional[str] = Field(default=None, pattern=UPI_RE)


class SplitIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    members: List[MemberIn] = Field(min_length=1, max_length=50)
    website: str = ""  # honeypot, humans never see it


class ExpenseIn(BaseModel):
    paid_by: int
    amount_paise: int = Field(gt=0, le=10**10)
    description: str = Field(min_length=1, max_length=100)
    split: Literal["equal", "exact"]
    participants: List[int] = []  # equal
    shares: Dict[int, int] = {}  # exact: member_id -> paise
    version: Optional[int] = None  # required on edit


# ---------- helpers ----------

def now():
    return int(time.time())


def hash_token(t):
    return hashlib.sha256(t.encode()).hexdigest()


def load_split(con, slug):
    s = con.execute("SELECT * FROM splits WHERE slug = ?", (slug,)).fetchone()
    if not s or (s["expires_at"] < now() and slug != DEMO):
        raise HTTPException(404, "Split not found or expired")
    t = now()
    con.execute("UPDATE splits SET last_activity_at = ?, expires_at = ? WHERE id = ?", (t, t + TTL, s["id"]))
    return s


def require_admin(s, token):
    if not token or not hmac.compare_digest(hash_token(token), s["admin_token_hash"]):
        raise HTTPException(403, "Admin link required")


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
    token = secrets.token_urlsafe(16)
    t = now()
    cur = con.execute(
        "INSERT INTO splits (slug, name, admin_token_hash, last_activity_at, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (slug, body.name, hash_token(token), t, t + TTL, t),
    )
    for m in body.members:
        con.execute("INSERT INTO members (split_id, name, upi_id) VALUES (?, ?, ?)", (cur.lastrowid, m.name, m.upi_id))
    log(con, cur.lastrowid, "created", None, {"name": body.name})
    return slug, token, cur.lastrowid


def seed_demo(con):
    con.execute("DELETE FROM splits WHERE slug = ?", (DEMO,))
    _, _, sid = create_split(con, SplitIn(name="Goa dinner (demo)", members=[
        MemberIn(name="Aman", upi_id="aman@okaxis"),
        MemberIn(name="Riya", upi_id="riya@ybl"),
        MemberIn(name="Kabir"),
    ]), slug=DEMO)
    a, r, k = member_ids(con, sid)
    for paid_by, amount, desc, shares in [
        (a, 240000, "Dinner at Britto's", money.split_equal(240000, [a, r, k])),
        (r, 90000, "Cab", money.split_equal(90000, [a, r, k])),
        (k, 50000, "Drinks", {a: 30000, k: 20000}),
    ]:
        cur = con.execute(
            "INSERT INTO expenses (split_id, paid_by, amount_paise, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            (sid, paid_by, amount, desc, now(), now()),
        )
        write_shares(con, cur.lastrowid, shares)


# ---------- API ----------

@app.post("/api/splits")
def create(body: SplitIn, con=Depends(db.get_db)):
    if body.website:
        raise HTTPException(400, "Bad request")
    names = [m.name.strip().lower() for m in body.members]
    if len(set(names)) != len(names):
        raise HTTPException(400, "Member names must be unique")
    slug, token, _ = create_split(con, body)
    con.commit()
    return {"slug": slug, "admin_token": token}


@app.get("/api/splits/{slug}")
def read(slug: str, con=Depends(db.get_db)):
    s = load_split(con, slug)
    con.commit()
    members = [dict(r) for r in con.execute("SELECT id, name, upi_id FROM members WHERE split_id = ? ORDER BY id", (s["id"],))]
    expenses = []
    for e in con.execute("SELECT * FROM expenses WHERE split_id = ? ORDER BY created_at DESC, id DESC", (s["id"],)):
        shares = {r["member_id"]: r["share_paise"] for r in con.execute("SELECT * FROM shares WHERE expense_id = ?", (e["id"],))}
        expenses.append({**{k: e[k] for k in ("id", "paid_by", "amount_paise", "description", "version", "created_at")},
                         "deleted": bool(e["deleted"]), "shares": shares})
    live = [(e["paid_by"], e["amount_paise"], e["shares"]) for e in expenses if not e["deleted"]]
    bal = money.balances([m["id"] for m in members], live)
    activity = [{**dict(r), "details": json.loads(r["details"])} for r in con.execute(
        "SELECT id, action, expense_id, details, created_at FROM activity WHERE split_id = ? ORDER BY id DESC LIMIT 50", (s["id"],))]
    return {
        "name": s["name"],
        "expires_at": None if slug == DEMO else s["expires_at"],
        "members": members,
        "expenses": expenses,
        "balances": bal,
        "settlement": [{"from": d, "to": c, "amount_paise": a} for d, c, a in money.settle(bal)],
        "activity": activity,
    }


@app.post("/api/splits/{slug}/expenses")
def add_expense(slug: str, body: ExpenseIn, con=Depends(db.get_db)):
    s = load_split(con, slug)
    shares = compute_shares(member_ids(con, s["id"]), body)
    cur = con.execute(
        "INSERT INTO expenses (split_id, paid_by, amount_paise, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        (s["id"], body.paid_by, body.amount_paise, body.description, now(), now()),
    )
    write_shares(con, cur.lastrowid, shares)
    log(con, s["id"], "added", cur.lastrowid, {"description": body.description, "amount_paise": body.amount_paise})
    con.commit()
    return {"id": cur.lastrowid}


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
    latest = con.execute("SELECT MAX(id) FROM activity WHERE expense_id = ?", (a["expense_id"],)).fetchone()[0]
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
def add_member(slug: str, body: MemberIn, x_admin_token: Optional[str] = Header(None), con=Depends(db.get_db)):
    s = load_split(con, slug)
    require_admin(s, x_admin_token)
    existing = [r["name"].strip().lower() for r in con.execute("SELECT name FROM members WHERE split_id = ?", (s["id"],))]
    if body.name.strip().lower() in existing:
        raise HTTPException(400, "Member names must be unique")
    con.execute("INSERT INTO members (split_id, name, upi_id) VALUES (?, ?, ?)", (s["id"], body.name, body.upi_id))
    log(con, s["id"], "member_added", None, {"name": body.name})
    con.commit()
    return {"ok": True}


@app.delete("/api/splits/{slug}")
def delete_split(slug: str, x_admin_token: Optional[str] = Header(None), con=Depends(db.get_db)):
    s = load_split(con, slug)
    require_admin(s, x_admin_token)
    con.execute("DELETE FROM splits WHERE id = ?", (s["id"],))
    con.commit()
    return {"ok": True}


@app.post("/cron/cleanup")
def cleanup(x_cron_secret: Optional[str] = Header(None), con=Depends(db.get_db)):
    secret = os.environ.get("CRON_SECRET")
    if not secret or not x_cron_secret or not hmac.compare_digest(secret, x_cron_secret):
        raise HTTPException(403)
    n = con.execute("DELETE FROM splits WHERE expires_at < ? AND slug != ?", (now(), DEMO)).rowcount
    seed_demo(con)  # reset demo so vandalism doesn't stick
    con.commit()
    return {"deleted": n}

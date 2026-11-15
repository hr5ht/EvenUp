import hashlib
import hmac
import json
import os
import re
import secrets
import time
from collections import defaultdict, deque
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request as UrlRequest, build_opener, urlopen
from typing import Annotated, Dict, List, Literal, Optional

import jwt
import qrcode
import qrcode.image.svg
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

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
AUTH_LIMIT = (20, 900)  # sign-ins, sign-ups and reset emails per IP. Neon Auth has its own limits behind this
FRIEND_LIMIT = (20, 24 * 3600)  # friend requests per user
INVITE_LIMIT = (1, 7 * 24 * 3600)  # emails from one person to one address, so cancel-and-resend can't pester anyone
EMAIL_RE = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
SITE = "https://getevenup.vercel.app"
FOREVER = 4102444800  # 1 Jan 2100: a group's expires_at, so groups never close or get cleaned up

# Neon Auth owns sign-up, passwords and sessions. This is its Auth URL, from the Neon Console.
NEON_AUTH = os.environ.get("NEON_AUTH_BASE_URL", "").strip("\"' ").rstrip("/")  # stray quotes would stop every page loading
NEON_ORIGIN = "{0.scheme}://{0.netloc}".format(urlsplit(NEON_AUTH))
JWKS = jwt.PyJWKClient(f"{NEON_AUTH}/.well-known/jwks.json") if NEON_AUTH else None
# The only Neon Auth routes this site forwards, so its admin routes stay out of reach.
AUTH_ROUTES = {"sign-up/email", "sign-in/email", "sign-out", "token", "request-password-reset", "reset-password", "delete-user"}

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


def client_ip(request):
    # Behind Vercel the socket peer is Vercel's proxy; it sets x-real-ip to the visitor's address.
    return (os.environ.get("VERCEL") and request.headers.get("x-real-ip")) or (request.client.host if request.client else "?")


@app.middleware("http")
async def security_headers(request, call_next):
    ip, path = client_ip(request), request.url.path
    if request.method != "GET" and path.startswith(("/api/", "/auth/")):
        creating = request.method == "POST" and path in ("/api/splits", "/api/demo")
        kind, limit = ("auth", AUTH_LIMIT) if path.startswith("/auth/") else ("create", CREATE_LIMIT) if creating else ("write", WRITE_LIMIT)
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
    if request.url.path != "/":  # only the landing page is indexable
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


@app.get("/login")
def login_page():
    return FileResponse(STATIC / "login.html")


@app.get("/profile")
def profile_page():
    return FileResponse(STATIC / "profile.html")


@app.get("/dashboard")
def dashboard_page():
    return RedirectResponse("/")  # Home is the dashboard now; old links and emails still land


@app.get("/friends")
def friends_page():
    return FileResponse(STATIC / "friends.html")


@app.get("/activity")
def activity_page():
    return FileResponse(STATIC / "activity.html")


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
    name: str = Field(default="Tab", min_length=1, max_length=40)  # "Tab 3": the opener's device counts its tabs
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


def group_member(con, s, user):
    """Your member id in a group, or None."""
    m = user and con.execute("SELECT id FROM members WHERE split_id = ? AND user_id = ?", (s["id"], user["id"])).fetchone()
    return m["id"] if m else None


def load_split(con, slug, ended_ok=False, user=None):
    s = con.execute("SELECT * FROM splits WHERE slug = ?", (slug,)).fetchone()
    if not s or s["expires_at"] + GRACE < now():
        raise HTTPException(404, "Tab not found or expired")
    # Groups are private. Only a route that passes the signed-in user can reach one, and only as a member,
    # so a route that forgets about groups refuses them instead of leaking one.
    if s["owner_user_id"] and not group_member(con, s, user):
        raise HTTPException(404, "Tab not found or expired")
    if not ended_ok and s["expires_at"] < now():
        raise HTTPException(410, "This tab is closed, so it can't be changed. Open a new one for new expenses.")
    return s


def require_admin(s, token, user=None):
    if s["owner_user_id"]:  # a group's admin is its owner, never "whoever picked the name"
        if not user or user["id"] != s["owner_user_id"]:
            raise HTTPException(403, "Only the group's owner can do that")
        return
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


def log(con, split_id, action, expense_id, details, user=None):
    if user:  # groups: a lasting ledger says who did what
        details = {**details, "by": user["name"]}
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


def create_split(con, body, name=None):
    name = name or body.name
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


# ---------- accounts ----------

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None  # hand Neon's redirect back to the browser instead of following it


def neon_call(method, path, body, headers):
    try:
        r = build_opener(NoRedirect).open(UrlRequest(f"{NEON_AUTH}/{path}", data=body or None, headers=headers, method=method), timeout=15)
    except HTTPError as e:
        r = e  # a 4xx from Neon is an answer for the browser, like "wrong password"
    return r.getcode(), r.headers, r.read()


def own_cookie(cookie):
    """Neon's session cookie, as this site's own: browsers (Safari above all) block third-party ones."""
    cookie = re.sub(r";\s*path=[^;]*", "; Path=/auth", re.sub(r";\s*domain=[^;]*", "", cookie, flags=re.I), flags=re.I)
    if not os.environ.get("VERCEL"):  # local development is plain http, where browsers refuse secure cookies
        cookie = re.sub(r";\s*(secure|partitioned)\b", "", cookie.removeprefix("__Secure-"), flags=re.I)
        cookie = re.sub(r"samesite=none", "SameSite=Lax", cookie, flags=re.I)
    return cookie


def neon_cookies(header):
    """What own_cookie changed for local development, put back for Neon."""
    if os.environ.get("VERCEL"):
        return header
    return "; ".join(f"__Secure-{c.strip()}" for c in header.split(";"))


@app.api_route("/auth/{path:path}", methods=["GET", "POST"])
async def auth_proxy(path: str, request: Request):
    """Forwards to Neon Auth, so the session cookie stays on this site."""
    if path not in AUTH_ROUTES:
        raise HTTPException(404)
    if not NEON_AUTH:
        raise HTTPException(503, "Sign in isn't set up yet.")
    headers = {k: request.headers[k] for k in ("content-type", "cookie", "origin", "user-agent") if k in request.headers}
    headers["x-forwarded-for"] = client_ip(request)
    if "cookie" in headers:
        headers["cookie"] = neon_cookies(headers["cookie"])
    try:
        status, got, body = await run_in_threadpool(neon_call, request.method, path, await request.body(), headers)
    except OSError:  # includes a dropped connection or a timeout
        raise HTTPException(502, "Sign in is unavailable right now. Try again in a minute.")
    resp = Response(body, status, media_type=got.get("content-type"), headers={"Cache-Control": "no-store"})
    for cookie in got.get_all("set-cookie") or []:
        resp.headers.append("set-cookie", own_cookie(cookie))
    return resp


def current_user(authorization: Optional[str] = Header(None), con=Depends(db.get_db)):
    """The signed-in user, from a Neon Auth token. Their row is made the first time we see them."""
    if not JWKS:
        raise HTTPException(503, "Sign in isn't set up yet.")
    token = (authorization or "").removeprefix("Bearer ")
    try:
        claims = jwt.decode(token, JWKS.get_signing_key_from_jwt(token).key, algorithms=["EdDSA"], issuer=NEON_ORIGIN,
                            audience=NEON_ORIGIN, options={"require": ["exp", "sub", "iss", "aud"]})
    except jwt.PyJWTError:
        raise HTTPException(401, "Sign in again.")
    u = con.execute("SELECT * FROM users WHERE id = ?", (claims["sub"],)).fetchone()
    if not u:
        email = claims["email"].lower()
        # Neon keeps emails unique, so a row with this email and another id is left from an account deleted there.
        con.execute("DELETE FROM users WHERE email = ?", (email,))
        name = (claims.get("name") or email.split("@")[0])[:40]
        u = con.execute("INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?) RETURNING *",
                        (claims["sub"], email, name, now())).fetchone()
        con.execute("UPDATE friends SET to_user = ? WHERE to_email = ? AND to_user IS NULL", (u["id"], email))  # invites waiting
        con.commit()
    return u


def maybe_user(authorization: Optional[str] = Header(None), con=Depends(db.get_db)):
    """The signed-in user when the request carries a token, else None. Only groups need one."""
    return current_user(authorization, con) if authorization else None


class ProfileIn(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=40)
    upi_id: Optional[str] = Field(default=None, pattern=UPI_RE)  # null clears it


def profile(u):
    return {"email": u["email"], "name": u["name"], "upi_id": dec(u["upi_id"])}


@app.get("/api/me")
def get_me(u=Depends(current_user)):
    return profile(u)


@app.patch("/api/me")
def update_me(body: ProfileIn, u=Depends(current_user), con=Depends(db.get_db)):
    name = (body.name or u["name"]).strip()
    if not name:
        raise HTTPException(400, "Enter your name")
    upi = enc(body.upi_id) if "upi_id" in body.model_fields_set else u["upi_id"]
    u = con.execute("UPDATE users SET name = ?, upi_id = ? WHERE id = ? RETURNING *", (name, upi, u["id"])).fetchone()
    con.execute("UPDATE members SET name = ?, upi_id = ? WHERE user_id = ?", (name, upi, u["id"]))  # you, in every group
    con.commit()
    return profile(u)


@app.delete("/api/me")
def delete_me(u=Depends(current_user), con=Depends(db.get_db)):
    # Your groups go to their longest-standing member, or away with you if nobody else has an account in them.
    for g in con.execute("SELECT id FROM splits WHERE owner_user_id = ?", (u["id"],)).fetchall():
        heir = con.execute("SELECT id, user_id FROM members WHERE split_id = ? AND user_id IS NOT NULL AND user_id != ? ORDER BY id LIMIT 1",
                           (g["id"], u["id"])).fetchone()
        if heir:
            con.execute("UPDATE splits SET owner_user_id = ?, admin_member_id = ? WHERE id = ?", (heir["user_id"], heir["id"], g["id"]))
        else:
            con.execute("DELETE FROM splits WHERE id = ?", (g["id"],))
    # Your rows stay so everyone else's balances still add up, but they're no longer you.
    con.execute("UPDATE members SET user_id = NULL, name = 'Deleted user', upi_id = NULL WHERE user_id = ?", (u["id"],))
    con.execute("DELETE FROM users WHERE id = ?", (u["id"],))
    con.commit()
    return {"ok": True}


# ---------- friends ----------

class FriendIn(BaseModel):
    email: str = Field(max_length=254, pattern=EMAIL_RE)


def limited(con, key, limit, window):
    """rate_limited() for limits that must hold across serverless instances."""
    t = now()
    hits = con.execute(
        "INSERT INTO rate_limits (key, window_start, hits) VALUES (?, ?, 1) ON CONFLICT (key) DO UPDATE SET "
        "hits = CASE WHEN rate_limits.window_start <= ? THEN 1 ELSE rate_limits.hits + 1 END, "
        "window_start = CASE WHEN rate_limits.window_start <= ? THEN ? ELSE rate_limits.window_start END RETURNING hits",
        (key, t, t - window, t - window, t)).fetchone()["hits"]
    con.commit()
    return hits > limit


def send_email(to, subject, text):
    """Best effort: a failed email never fails the request, the in-app request is still there.
    Sends nothing until RESEND_API_KEY and EMAIL_FROM are set."""
    key, sender = os.environ.get("RESEND_API_KEY"), os.environ.get("EMAIL_FROM")
    if not key or not sender:
        return
    try:
        urlopen(UrlRequest("https://api.resend.com/emails", method="POST",
                           data=json.dumps({"from": sender, "to": to, "subject": subject, "text": text}).encode(),
                           headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json", "User-Agent": "EvenUp"}), timeout=5)
    except OSError as e:
        print("Email failed:", type(e).__name__)


@app.post("/api/friends")
def add_friend(body: FriendIn, u=Depends(current_user), con=Depends(db.get_db)):
    """The answer never says whether the email has an account: same response, same steps, same email."""
    email = body.email.strip().lower()
    if email == u["email"]:
        raise HTTPException(400, "That's your own email.")
    if limited(con, f"friends:{u['id']}", *FRIEND_LIMIT):
        raise HTTPException(429, "That's a lot of friend requests for one day. Try again tomorrow.")
    other = con.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
    theirs = other and con.execute("SELECT id FROM friends WHERE from_user = ? AND to_user = ?", (other["id"], u["id"])).fetchone()
    new = None
    if theirs:  # they already asked, so this is a yes
        con.execute("UPDATE friends SET status = 'accepted' WHERE id = ?", (theirs["id"],))
        link_invites(con, u, other["id"])
    else:
        new = con.execute(
            "INSERT INTO friends (from_user, to_email, to_user, created_at) VALUES (?, ?, ?, ?) "
            "ON CONFLICT (from_user, to_email) DO NOTHING RETURNING id",
            (u["id"], email, other and other["id"], now())).fetchone()
    con.commit()
    if new and not limited(con, f"invite:{u['id']}:{email}", *INVITE_LIMIT):
        send_email(email, f"{u['name']} wants to split bills with you on EvenUp",
                   f"{u['name']} ({u['email']}) added you as a friend on EvenUp.\n\nSee the request: {SITE}/friends\n\n"
                   "If you don't know them, you can ignore this email.")
    return {"ok": True}


@app.get("/api/friends")
def list_friends(u=Depends(current_user), con=Depends(db.get_db)):
    rows = con.execute(
        "SELECT f.*, a.name AS from_name, a.email AS from_email, b.name AS to_name FROM friends f "
        "JOIN users a ON a.id = f.from_user LEFT JOIN users b ON b.id = f.to_user "
        "WHERE f.from_user = ? OR f.to_user = ? ORDER BY f.id DESC", (u["id"], u["id"])).fetchall()
    out = {"friends": [], "requests": [], "sent": []}
    for f in rows:
        mine = f["from_user"] == u["id"]
        them = {"id": f["id"], "name": f["to_name"], "email": f["to_email"]} if mine else {"id": f["id"], "name": f["from_name"], "email": f["from_email"]}
        if f["status"] == "accepted":
            out["friends"].append(them)
        elif mine:  # a decline stays "sent": the sender is never told, and sees no name before a yes
            out["sent"].append({"id": f["id"], "email": f["to_email"]})
        elif f["status"] == "pending":
            out["requests"].append(them)
    return out


def link_invites(con, u, inviter_id):
    """Saying yes to someone links you to the places they saved for your email in their groups."""
    con.execute("UPDATE members SET user_id = ?, name = ?, upi_id = ?, invite_email = NULL "
                "WHERE invite_email = ? AND user_id IS NULL AND split_id IN (SELECT split_id FROM members WHERE user_id = ?) "
                "AND split_id NOT IN (SELECT split_id FROM members WHERE user_id = ?)",
                (u["id"], u["name"], u["upi_id"], u["email"], inviter_id, u["id"]))


def answer_friend(con, friend_id, u, status):
    f = con.execute("UPDATE friends SET status = ? WHERE id = ? AND to_user = ? AND status = 'pending' RETURNING from_user",
                    (status, friend_id, u["id"])).fetchone()
    if not f:
        raise HTTPException(404, "Request not found")
    if status == "accepted":
        link_invites(con, u, f["from_user"])
    con.commit()
    return {"ok": True}


@app.post("/api/friends/{friend_id}/accept")
def accept_friend(friend_id: int, u=Depends(current_user), con=Depends(db.get_db)):
    return answer_friend(con, friend_id, u, "accepted")


@app.post("/api/friends/{friend_id}/decline")
def decline_friend(friend_id: int, u=Depends(current_user), con=Depends(db.get_db)):
    return answer_friend(con, friend_id, u, "declined")


@app.delete("/api/friends/{friend_id}")
def remove_friend(friend_id: int, u=Depends(current_user), con=Depends(db.get_db)):
    """Remove a friend, or cancel a request you sent."""
    if not con.execute("DELETE FROM friends WHERE id = ? AND (from_user = ? OR (to_user = ? AND status = 'accepted'))",
                       (friend_id, u["id"], u["id"])).rowcount:
        raise HTTPException(404, "Friend not found")
    con.commit()
    return {"ok": True}


# ---------- groups ----------
# A group is a split with an owner and no end: expenses, balances, undo and /g/{slug} all work unchanged.
# Its members are accounts, added from your friends, and only they can open it.

Email = Annotated[str, Field(max_length=254, pattern=EMAIL_RE)]


class GroupIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    friend_ids: List[int] = Field(default=[], max_length=MAX_MEMBERS - 1)  # ids from /api/friends
    emails: List[Email] = Field(default=[], max_length=MAX_MEMBERS - 1)  # anyone else


class GroupMemberIn(BaseModel):  # one or the other
    friend_id: Optional[int] = None
    email: Optional[Email] = None


class RenameIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)


class OwnerIn(BaseModel):
    member_id: int


def friend_user(con, u, friend_id):
    """The account behind one of your accepted friends."""
    f = con.execute("SELECT * FROM friends WHERE id = ? AND status = 'accepted' AND (from_user = ? OR to_user = ?)",
                    (friend_id, u["id"], u["id"])).fetchone()
    if not f:
        raise HTTPException(404, "Friend not found")
    return con.execute("SELECT * FROM users WHERE id = ?", (f["to_user"] if f["from_user"] == u["id"] else f["from_user"],)).fetchone()


def add_user_member(con, split_id, user):
    # The UPI ID is copied encrypted as it is; saving your profile updates it in every group.
    return con.execute("INSERT INTO members (split_id, name, upi_id, user_id) VALUES (?, ?, ?, ?) RETURNING id",
                       (split_id, user["name"], user["upi_id"], user["id"])).fetchone()["id"]


def add_to_group(con, sid, u, friend_id=None, email=None):
    """One of your friends, or anyone by email. Someone added by email gets a friend request and a place
    in the group straight away, so expenses can include them; it becomes their account when they say yes."""
    if len(member_ids(con, sid)) >= MAX_MEMBERS:
        raise HTTPException(400, f"A group holds {MAX_MEMBERS} people at most")
    if email:
        email = email.strip().lower()
        if con.execute("SELECT 1 FROM members m JOIN users x ON x.id = m.user_id WHERE m.split_id = ? AND x.email = ?",
                       (sid, email)).fetchone() or con.execute(
                "SELECT 1 FROM members WHERE split_id = ? AND invite_email = ?", (sid, email)).fetchone():
            raise HTTPException(400, f"{email} is already in this group")
        add_friend(FriendIn(email=email), u, con)  # your own email, rate limits and the invite email are handled there
        f = con.execute("SELECT f.id FROM friends f JOIN users x ON x.email = ? WHERE f.status = 'accepted' AND "
                        "((f.from_user = ? AND f.to_user = x.id) OR (f.from_user = x.id AND f.to_user = ?))",
                        (email, u["id"], u["id"])).fetchone()
        if not f:  # not friends yet: a named place, waiting for them
            name = email.split("@")[0][:40]
            mid = con.execute("INSERT INTO members (split_id, name, invite_email) VALUES (?, ?, ?) RETURNING id",
                              (sid, name, email)).fetchone()["id"]
            return mid, name
        friend_id = f["id"]
    other = friend_user(con, u, friend_id)
    if con.execute("SELECT id FROM members WHERE split_id = ? AND user_id = ?", (sid, other["id"])).fetchone():
        raise HTTPException(400, f"{other['name']} is already in this group")
    return add_user_member(con, sid, other), other["name"]


def group_of(con, slug, u, ended_ok=False):
    s = load_split(con, slug, ended_ok=ended_ok, user=u)
    if not s["owner_user_id"]:
        raise HTTPException(404, "Group not found")
    return s


def money_of(con, split_id):
    """(spent, balances) of a split's live expenses, without loading everything read() returns."""
    ex = {}
    for r in con.execute("SELECT e.id, e.paid_by, e.amount_paise, e.kind, sh.member_id, sh.share_paise FROM expenses e "
                         "JOIN shares sh ON sh.expense_id = e.id WHERE e.split_id = ? AND e.deleted = 0", (split_id,)):
        ex.setdefault(r["id"], (r["paid_by"], r["amount_paise"], r["kind"], {}))[3][r["member_id"]] = r["share_paise"]
    spent = sum(a for _, a, kind, _ in ex.values() if kind == "expense")
    return spent, money.balances(member_ids(con, split_id), [(p, a, sh) for p, a, _, sh in ex.values()])


@app.post("/api/groups")
def create_group(body: GroupIn, u=Depends(current_user), con=Depends(db.get_db)):
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Give the group a name")
    others = {o["id"]: o for o in (friend_user(con, u, i) for i in set(body.friend_ids))}
    slug, t = secrets.token_urlsafe(16), now()
    sid = con.execute("INSERT INTO splits (slug, name, admin_pw_hash, last_activity_at, expires_at, created_at, owner_user_id) "
                      "VALUES (?, ?, '', ?, ?, ?, ?) RETURNING id", (slug, name, t, FOREVER, t, u["id"])).fetchone()["id"]
    me = add_user_member(con, sid, u)
    for o in others.values():
        add_user_member(con, sid, o)
    con.execute("UPDATE splits SET admin_member_id = ? WHERE id = ?", (me, sid))
    log(con, sid, "created", None, {"name": name}, u)
    con.commit()
    for email in dict.fromkeys(e.strip().lower() for e in body.emails):
        if email != u["email"]:
            add_to_group(con, sid, u, email=email)
    con.commit()
    return {"slug": slug}


def my_splits(con, u, groups):
    """Your groups, or your tabs (the ones you're tied to), newest first, with what was spent and where you stand."""
    out = []
    for g in con.execute("SELECT s.id, s.slug, s.name, s.created_at, s.expires_at, s.admin_member_id, m.id AS me, m.pw_hash FROM splits s "
                         "JOIN members m ON m.split_id = s.id WHERE m.user_id = ? AND (s.owner_user_id IS NOT NULL) = ? "
                         "AND s.expires_at + ? > ? ORDER BY s.created_at DESC", (u["id"], groups, GRACE, now())).fetchall():
        spent, bal = money_of(con, g["id"])
        last = con.execute("SELECT MAX(created_at) AS t FROM activity WHERE split_id = ?", (g["id"],)).fetchone()["t"]
        row = {"slug": g["slug"], "name": g["name"], "ended": g["expires_at"] < now(), "spent": spent, "balance": bal.get(g["me"], 0),
               "updated_at": last or g["created_at"], "members": [r["name"] for r in con.execute("SELECT name FROM members WHERE split_id = ? ORDER BY id", (g["id"],))]}
        if not groups:  # a tab knows you by its own session, so a new device gets that from your account
            token = g["pw_hash"] and admin_token(g["id"], g["pw_hash"])
            row.update(expires_at=g["expires_at"], me=g["me"], token=token, admin_token=token if g["me"] == g["admin_member_id"] else None)
        out.append(row)
    return out


@app.get("/api/groups")
def list_groups(u=Depends(current_user), con=Depends(db.get_db)):
    return my_splits(con, u, True)


@app.get("/api/tabs")
def list_tabs(u=Depends(current_user), con=Depends(db.get_db)):
    return my_splits(con, u, False)


class ClaimIn(BaseModel):
    member_id: int


@app.post("/api/splits/{slug}/claim")
def claim(slug: str, body: ClaimIn, x_member_token: Optional[str] = Header(None), u=Depends(current_user), con=Depends(db.get_db)):
    """Ties who you are in a tab to your account, so it's on your list on every device. It takes what acting as them
    takes: nothing in a tab without passwords, their session in a protected one."""
    s = load_split(con, slug, ended_ok=True)  # groups 404 here: they're tied to accounts already
    m = con.execute("SELECT * FROM members WHERE id = ? AND split_id = ?", (body.member_id, s["id"])).fetchone()
    if not m:
        raise HTTPException(404, "Member not found")
    protected, who = member_auth(con, s, x_member_token)
    if protected and who != m["id"]:
        raise HTTPException(403, "Enter your password first")
    if m["user_id"] and m["user_id"] != u["id"]:
        raise HTTPException(409, "Someone else's account has that name in this tab")
    con.execute("UPDATE members SET user_id = NULL WHERE split_id = ? AND user_id = ?", (s["id"], u["id"]))  # one of you per tab
    con.execute("UPDATE members SET user_id = ? WHERE id = ?", (u["id"], m["id"]))
    con.commit()
    return {"ok": True}


@app.post("/api/groups/{slug}/members")
def add_group_member(slug: str, body: GroupMemberIn, u=Depends(current_user), con=Depends(db.get_db)):
    """Any member can bring in one of their friends, or anyone by email."""
    s = group_of(con, slug, u)
    if not body.friend_id and not body.email:
        raise HTTPException(400, "Pick a friend or enter an email")
    mid, name = add_to_group(con, s["id"], u, body.friend_id, body.email)
    log(con, s["id"], "member_added", None, {"name": name}, u)
    con.commit()
    return {"id": mid}


@app.patch("/api/groups/{slug}")
def rename_group(slug: str, body: RenameIn, u=Depends(current_user), con=Depends(db.get_db)):
    s = group_of(con, slug, u)
    require_admin(s, None, u)
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Give the group a name")
    con.execute("UPDATE splits SET name = ? WHERE id = ?", (name, s["id"]))
    log(con, s["id"], "renamed", None, {"name": name}, u)
    con.commit()
    return {"ok": True}


@app.post("/api/groups/{slug}/owner")
def hand_over_group(slug: str, body: OwnerIn, u=Depends(current_user), con=Depends(db.get_db)):
    s = group_of(con, slug, u)
    require_admin(s, None, u)
    m = con.execute("SELECT * FROM members WHERE id = ? AND split_id = ? AND user_id IS NOT NULL", (body.member_id, s["id"])).fetchone()
    if not m:
        raise HTTPException(404, "Only someone with an account can own the group")
    con.execute("UPDATE splits SET owner_user_id = ?, admin_member_id = ? WHERE id = ?", (m["user_id"], m["id"], s["id"]))
    log(con, s["id"], "owner_changed", None, {"name": m["name"]}, u)
    con.commit()
    return {"ok": True}


@app.post("/api/groups/{slug}/leave")
def leave_group(slug: str, u=Depends(current_user), con=Depends(db.get_db)):
    s = group_of(con, slug, u)
    me = group_member(con, s, u)
    if money_of(con, s["id"])[1].get(me, 0):
        raise HTTPException(400, "Settle up first: you can leave once you owe nothing and are owed nothing.")
    if s["owner_user_id"] == u["id"]:  # the group passes to its longest-standing member
        heir = con.execute("SELECT id, user_id FROM members WHERE split_id = ? AND user_id IS NOT NULL AND id != ? ORDER BY id LIMIT 1",
                           (s["id"], me)).fetchone()
        if not heir:
            raise HTTPException(400, "You're the only one here with an account. Delete the group instead.")
        con.execute("UPDATE splits SET owner_user_id = ?, admin_member_id = ? WHERE id = ?", (heir["user_id"], heir["id"], s["id"]))
    if con.execute("SELECT 1 FROM expenses WHERE split_id = ? AND (paid_by = ? OR id IN (SELECT expense_id FROM shares WHERE member_id = ?))",
                   (s["id"], me, me)).fetchone():
        # Past expenses still need your name to add up, but the group is no longer yours to open.
        con.execute("UPDATE members SET user_id = NULL, upi_id = NULL WHERE id = ?", (me,))
    else:
        con.execute("DELETE FROM members WHERE id = ?", (me,))
    log(con, s["id"], "member_left", None, {"name": u["name"]}, u)
    con.commit()
    return {"ok": True}


@app.post("/api/groups/{slug}/restore")
def restore_group(slug: str, u=Depends(current_user), con=Depends(db.get_db)):
    """A deleted group stays readable for a day, and its owner can bring it back."""
    s = group_of(con, slug, u, ended_ok=True)
    require_admin(s, None, u)
    con.execute("UPDATE splits SET expires_at = ? WHERE id = ?", (FOREVER, s["id"]))
    log(con, s["id"], "group_restored", None, {"name": s["name"]}, u)
    con.commit()
    return {"ok": True}


@app.get("/api/me/activity")
def my_activity(u=Depends(current_user), con=Depends(db.get_db)):
    """The latest changes across every group you're in."""
    rows = con.execute(
        "SELECT a.id, a.action, a.expense_id, a.details, a.created_at, s.slug, s.name AS group_name FROM activity a "
        "JOIN splits s ON s.id = a.split_id JOIN members m ON m.split_id = s.id "
        "WHERE m.user_id = ? AND s.owner_user_id IS NOT NULL ORDER BY a.id DESC LIMIT 50", (u["id"],)).fetchall()
    return [{**dict(r), "details": json.loads(r["details"])} for r in rows]


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
    # @evenup isn't a real UPI handle, so a demo Pay can never reach a real account.
    body = SplitIn(members=[
        MemberIn(name="Guest", upi_id="guest@evenup"), MemberIn(name="Riya", upi_id="riya@evenup"),
        MemberIn(name="Kabir", upi_id="kabir@evenup"), MemberIn(name="Aman", upi_id="aman@evenup")])
    slug, token, sid, _ = create_split(con, body, "Tab (demo)")
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
        add_expense(slug, e, x_member_token=None, user=None, con=con)
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
def read(slug: str, user=Depends(maybe_user), con=Depends(db.get_db)):
    s = load_split(con, slug, ended_ok=True, user=user)
    ended = s["expires_at"] < now()
    # Nobody pays through an ended split, so its UPI IDs stop being shown.
    rows = con.execute("SELECT * FROM members WHERE split_id = ? ORDER BY id", (s["id"],)).fetchall()
    members = [{"id": r["id"], "name": r["name"], "upi_id": None if ended else dec(r["upi_id"]),
                "has_password": r["pw_hash"] is not None,
                "account": r["user_id"] is not None, "invited": r["invite_email"] is not None} for r in rows]  # groups
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
        "group": bool(s["owner_user_id"]),
        "me": group_member(con, s, user) if s["owner_user_id"] else None,  # groups know who you are from your account
    }


def upi_link(upi_id, name, amount_paise, note):
    # Same format as upiLink() in split.js. %20 not +, some UPI apps don't decode +.
    return "upi://pay?" + urlencode({
        "pa": upi_id, "pn": name, "am": f"{amount_paise // 100}.{amount_paise % 100:02d}", "cu": "INR", "tn": note[:50],
    }, safe="@", quote_via=quote)


@app.get("/api/splits/{slug}/qr")
def qr(slug: str, to: int, amount: int, user=Depends(maybe_user), con=Depends(db.get_db)):
    """UPI QR for paying a member of this split. Only encodes this split's own UPI IDs."""
    s = load_split(con, slug, user=user)
    m = con.execute("SELECT * FROM members WHERE id = ? AND split_id = ?", (to, s["id"])).fetchone()
    if not m or not m["upi_id"] or not 0 < amount <= 10**10:
        raise HTTPException(404, "No UPI ID for this member")
    img = qrcode.make(upi_link(dec(m["upi_id"]), m["name"], amount, s["name"]),
                      image_factory=qrcode.image.svg.SvgPathImage, border=2)
    return Response(img.to_string(encoding="unicode"), media_type="image/svg+xml",
                    headers={"Cache-Control": "private, max-age=300"})


@app.post("/api/splits/{slug}/expenses")
def add_expense(slug: str, body: ExpenseIn, x_member_token: Optional[str] = Header(None), user=Depends(maybe_user),
                con=Depends(db.get_db)):
    s = load_split(con, slug, user=user)
    require_member(con, s, x_member_token)
    shares = compute_shares(member_ids(con, s["id"]), body)
    if body.kind == "payment" and (len(shares) != 1 or body.paid_by in shares):
        raise HTTPException(400, "A payment goes from one member to one other member")
    if s["owner_user_id"] and body.kind == "payment" and group_member(con, s, user) not in (body.paid_by, *shares):
        raise HTTPException(403, "Only the person paying or being paid can record a payment")
    eid = con.execute(
        "INSERT INTO expenses (split_id, paid_by, amount_paise, description, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
        (s["id"], body.paid_by, body.amount_paise, body.description, body.kind, now(), now()),
    ).fetchone()["id"]
    write_shares(con, eid, shares)
    log(con, s["id"], "added", eid, {"description": body.description, "amount_paise": body.amount_paise}, user)
    con.commit()
    return {"id": eid}


@app.put("/api/splits/{slug}/expenses/{expense_id}")
def edit_expense(slug: str, expense_id: int, body: ExpenseIn, x_member_token: Optional[str] = Header(None),
                 user=Depends(maybe_user), con=Depends(db.get_db)):
    s = load_split(con, slug, user=user)
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
        {"description": body.description, "amount_paise": body.amount_paise, "prev": prev}, user)
    con.commit()
    return {"ok": True}


@app.delete("/api/splits/{slug}/expenses/{expense_id}")
def delete_expense(slug: str, expense_id: int, x_member_token: Optional[str] = Header(None), user=Depends(maybe_user),
                   con=Depends(db.get_db)):
    s = load_split(con, slug, user=user)
    require_member(con, s, x_member_token)
    set_deleted(con, s["id"], get_expense(con, s["id"], expense_id), True, user)
    con.commit()
    return {"ok": True}


def set_deleted(con, split_id, e, deleted, user=None):
    con.execute("UPDATE expenses SET deleted = ?, version = version + 1 WHERE id = ?", (int(deleted), e["id"]))
    log(con, split_id, "deleted" if deleted else "restored", e["id"],
        {"description": e["description"], "amount_paise": e["amount_paise"]}, user)


@app.post("/api/splits/{slug}/activity/{activity_id}/undo")
def undo(slug: str, activity_id: int, x_member_token: Optional[str] = Header(None), user=Depends(maybe_user),
         con=Depends(db.get_db)):
    """Undo the latest change to an expense. The undo is itself logged, so it can be undone too."""
    s = load_split(con, slug, user=user)
    require_member(con, s, x_member_token)
    a = con.execute("SELECT * FROM activity WHERE id = ? AND split_id = ?", (activity_id, s["id"])).fetchone()
    if not a or a["expense_id"] is None:
        raise HTTPException(404, "Nothing to undo")
    latest = con.execute("SELECT MAX(id) AS latest FROM activity WHERE expense_id = ?", (a["expense_id"],)).fetchone()["latest"]
    if latest != a["id"]:
        raise HTTPException(409, "Only the latest change to an expense can be undone. Reload and try again.")
    e = get_expense(con, s["id"], a["expense_id"])
    if a["action"] in ("added", "restored"):
        set_deleted(con, s["id"], e, True, user)
    elif a["action"] == "deleted":
        set_deleted(con, s["id"], e, False, user)
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
            {"description": prev["description"], "amount_paise": prev["amount_paise"], "prev": current}, user)
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
def remove_member(slug: str, member_id: int, x_admin_token: Optional[str] = Header(None), user=Depends(maybe_user),
                  con=Depends(db.get_db)):
    s = load_split(con, slug, user=user)
    require_admin(s, x_admin_token, user)
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
    log(con, s["id"], "member_removed", None, {"name": m["name"]}, user)
    con.commit()
    return {"ok": True}


@app.delete("/api/splits/{slug}")
def delete_split(slug: str, x_admin_token: Optional[str] = Header(None), user=Depends(maybe_user), con=Depends(db.get_db)):
    s = load_split(con, slug, ended_ok=True, user=user)
    require_admin(s, x_admin_token, user)
    if s["owner_user_id"]:  # a group goes read-only for a day, so its owner can restore it, then cleanup takes it
        if s["expires_at"] > now():
            con.execute("UPDATE splits SET expires_at = ? WHERE id = ?", (now() - 1, s["id"]))
            log(con, s["id"], "group_deleted", None, {"name": s["name"]}, user)
            con.commit()
            for r in con.execute("SELECT x.email FROM members m JOIN users x ON x.id = m.user_id WHERE m.split_id = ? AND x.id != ?",
                                 (s["id"], user["id"])).fetchall():
                send_email(r["email"], f"{s['name']} was deleted on EvenUp",
                           f"{user['name']} deleted the group {s['name']} on EvenUp. You can still see it until tomorrow: {SITE}/g/{slug}")
        return {"ok": True}
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
    con.execute("DELETE FROM rate_limits WHERE window_start < ?", (now() - INVITE_LIMIT[1],))
    con.commit()
    return {"deleted": n}

import os
import tempfile

os.environ["EVENUP_DB"] = os.path.join(tempfile.mkdtemp(), "test.db")  # SQLite unless DATABASE_URL is set
os.environ["CRON_SECRET"] = "s3cret"

from fastapi.testclient import TestClient  # noqa: E402

from app import money  # noqa: E402
from app.main import app  # noqa: E402


def test_split_equal_rounding():
    assert money.split_equal(10000, [1, 2, 3]) == {1: 3334, 2: 3333, 3: 3333}
    assert sum(money.split_equal(1, [1, 2, 3]).values()) == 1


def test_settle():
    assert money.settle({"a": 0, "b": 0}) == []
    assert money.settle({"a": 0}) == []
    pays = money.settle({"a": 300, "b": -100, "c": -200})
    assert sorted(pays) == [("b", "a", 100), ("c", "a", 200)]
    bal = {"a": 500, "b": 250, "c": -400, "d": -350}
    pays = money.settle(bal)
    assert len(pays) <= len(bal) - 1
    for d, c, amt in pays:
        bal[d] += amt
        bal[c] -= amt
    assert all(v == 0 for v in bal.values())
    # exact match d->b first: 3 payments, where plain greedy needs 4
    bal = {"a": 700, "b": 300, "c": -500, "d": -300, "e": -200}
    pays = money.settle(bal)
    assert len(pays) == 3
    for d, c, amt in pays:
        bal[d] += amt
        bal[c] -= amt
    assert all(v == 0 for v in bal.values())


def test_flow():
    with TestClient(app) as c:
        r = c.post("/api/splits", json={"name": "Dinner", "members": [
            {"name": "A", "upi_id": "a@ybl"}, {"name": "B"}, {"name": "C"}]})
        assert r.status_code == 200
        slug, token = r.json()["slug"], r.json()["admin_token"]
        assert len(slug) >= 22
        g = c.get(f"/api/splits/{slug}").json()
        a, b, cc = [m["id"] for m in g["members"]]
        assert r.json()["admin_id"] == g["admin_id"] == a  # first member is the admin

        # equal split, uneven paise
        r = c.post(f"/api/splits/{slug}/expenses", json={
            "paid_by": a, "amount_paise": 10000, "description": "Food", "split": "equal", "participants": [a, b, cc]})
        eid = r.json()["id"]
        g = c.get(f"/api/splits/{slug}").json()
        assert sum(g["balances"].values()) == 0
        assert g["balances"][str(a)] == 10000 - 3334

        # exact shares must add up
        r = c.post(f"/api/splits/{slug}/expenses", json={
            "paid_by": b, "amount_paise": 500, "description": "x", "split": "exact", "shares": {str(a): 100}})
        assert r.status_code == 400

        # optimistic lock
        body = {"paid_by": a, "amount_paise": 9000, "description": "Food", "split": "equal", "participants": [a, b], "version": 1}
        assert c.put(f"/api/splits/{slug}/expenses/{eid}", json=body).status_code == 200
        assert c.put(f"/api/splits/{slug}/expenses/{eid}", json=body).status_code == 409

        # undo edit, then undo the undo
        undo = lambda: c.post(f"/api/splits/{slug}/activity/{latest()}/undo")  # noqa: E731
        latest = lambda: c.get(f"/api/splits/{slug}").json()["activity"][0]["id"]  # noqa: E731
        assert undo().status_code == 200
        assert c.get(f"/api/splits/{slug}").json()["balances"][str(a)] == 10000 - 3334
        assert undo().status_code == 200
        assert c.get(f"/api/splits/{slug}").json()["balances"][str(a)] == 4500

        # delete + undo
        c.delete(f"/api/splits/{slug}/expenses/{eid}")
        assert c.get(f"/api/splits/{slug}").json()["settlement"] == []
        older = c.get(f"/api/splits/{slug}").json()["activity"][1]["id"]
        assert c.post(f"/api/splits/{slug}/activity/{older}/undo").status_code == 409  # not the latest
        assert undo().status_code == 200
        assert c.get(f"/api/splits/{slug}").json()["settlement"] == [{"from": b, "to": a, "amount_paise": 4500}]

        # payer must belong to this split
        r = c.post(f"/api/splits/{slug}/expenses", json={
            "paid_by": 999999, "amount_paise": 100, "description": "x", "split": "equal", "participants": [a]})
        assert r.status_code == 400

        # no passwords: whoever picks the admin's name is the admin, so admin actions need no token
        assert g["open_admin"] and not g["protected"] and not g["admin_login"]
        assert c.post(f"/api/splits/{slug}/admin-login", json={"password": ""}).status_code == 401

        # anyone can join; names stay unique
        assert c.post(f"/api/splits/{slug}/members", json={"name": "D"}).status_code == 200
        assert c.post(f"/api/splits/{slug}/members", json={"name": "d"}).status_code == 400

        # remove member: blocked while in a live expense, the admin never, anyone else is fine
        assert c.delete(f"/api/splits/{slug}/members/{b}").status_code == 400
        assert c.delete(f"/api/splits/{slug}/members/{a}").json()["detail"] == "The admin can't be removed"
        assert c.delete(f"/api/splits/{slug}/members/{cc}").status_code == 200
        assert len(c.get(f"/api/splits/{slug}").json()["members"]) == 3
        assert c.delete(f"/api/splits/{slug}").status_code == 200
        assert c.get(f"/api/splits/{slug}").status_code == 404


def test_cross_split_access_and_guards():
    with TestClient(app) as c:
        s1 = c.post("/api/splits", json={"name": "One", "members": [{"name": "A"}]}).json()["slug"]
        s2 = c.post("/api/splits", json={"name": "Two", "members": [{"name": "B"}]}).json()["slug"]
        a = c.get(f"/api/splits/{s1}").json()["members"][0]["id"]
        eid = c.post(f"/api/splits/{s1}/expenses", json={
            "paid_by": a, "amount_paise": 100, "description": "x", "split": "equal", "participants": [a]}).json()["id"]
        # expense of split 1 can't be touched through split 2
        assert c.delete(f"/api/splits/{s2}/expenses/{eid}").status_code == 404
        # honeypot, duplicate names, bad UPI
        assert c.post("/api/splits", json={"name": "x", "members": [{"name": "A"}], "website": "spam"}).status_code == 400
        assert c.post("/api/splits", json={"name": "x", "members": [{"name": "A"}, {"name": "a"}]}).status_code == 400
        assert c.post("/api/splits", json={"name": "x", "members": [{"name": "A", "upi_id": "nope"}]}).status_code == 422
        # cron needs the secret
        assert c.post("/cron/cleanup").status_code == 403
        assert c.post("/cron/cleanup", headers={"X-Cron-Secret": "s3cret"}).status_code == 200
        assert c.get("/cron/cleanup", headers={"Authorization": "Bearer s3cret"}).status_code == 200  # Vercel Cron
        assert c.get("/cron/cleanup", headers={"Authorization": "Bearer nope"}).status_code == 403
        assert "Content-Security-Policy" in c.get("/").headers


def test_settle_up_payment():
    with TestClient(app, client=("10.0.0.2", 1)) as c:
        slug = c.post("/api/splits", json={"name": "P", "members": [{"name": "A"}, {"name": "B"}]}).json()["slug"]
        a, b = [m["id"] for m in c.get(f"/api/splits/{slug}").json()["members"]]
        c.post(f"/api/splits/{slug}/expenses", json={
            "paid_by": a, "amount_paise": 1000, "description": "Food", "split": "equal", "participants": [a, b]})
        assert c.get(f"/api/splits/{slug}").json()["settlement"] == [{"from": b, "to": a, "amount_paise": 500}]
        pay = {"kind": "payment", "paid_by": b, "amount_paise": 500, "description": "B paid A · cash", "split": "exact"}
        assert c.post(f"/api/splits/{slug}/expenses", json={**pay, "shares": {str(b): 500}}).status_code == 400  # to self
        assert c.post(f"/api/splits/{slug}/expenses", json={**pay, "split": "equal", "participants": [a, b]}).status_code == 400
        assert c.post(f"/api/splits/{slug}/expenses", json={**pay, "shares": {str(a): 500}}).status_code == 200
        g = c.get(f"/api/splits/{slug}").json()
        assert g["settlement"] == [] and g["balances"] == {str(a): 0, str(b): 0}
        assert [e["kind"] for e in g["expenses"]] == ["payment", "expense"]


def test_rate_limit():
    with TestClient(app, client=("10.0.0.1", 1)) as c:
        codes = [c.post("/api/splits", json={"name": "x", "members": [{"name": "A"}]}).status_code for _ in range(11)]
        assert codes[:10] == [200] * 10 and codes[10] == 429


def test_upi_encrypted_at_rest():
    from app import db
    with TestClient(app) as c:
        slug = c.post("/api/splits", json={"name": "x", "members": [{"name": "A", "upi_id": "secret@ybl"}]}).json()["slug"]
        assert c.get(f"/api/splits/{slug}").json()["members"][0]["upi_id"] == "secret@ybl"
        con = db.connect()
        stored = con.execute("SELECT upi_id FROM members WHERE name = 'A' ORDER BY id DESC").fetchone()["upi_id"]
        con.close()
        assert "secret" not in stored


def test_qr():
    from app.main import upi_link
    assert upi_link("a@ybl", "Aman K", 12345, "Goa trip") == "upi://pay?pa=a@ybl&pn=Aman%20K&am=123.45&cu=INR&tn=Goa%20trip"
    with TestClient(app, client=("10.0.0.3", 1)) as c:
        slug = c.post("/api/splits", json={"name": "Q", "members": [
            {"name": "Aman", "upi_id": "aman@okaxis"}, {"name": "Kabir"}]}).json()["slug"]
        aman, kabir = [m["id"] for m in c.get(f"/api/splits/{slug}").json()["members"]]
        r = c.get(f"/api/splits/{slug}/qr?to={aman}&amount=80000")
        assert r.status_code == 200 and r.headers["content-type"].startswith("image/svg+xml")
        assert c.get(f"/api/splits/{slug}/qr?to={kabir}&amount=100").status_code == 404  # no UPI ID


def test_lifetime():
    from app import db
    from app.main import GRACE, TTL, now

    def age(slug, seconds):  # pretend the split was created `seconds` ago
        con = db.connect()
        con.execute("UPDATE splits SET expires_at = ? WHERE slug = ?", (now() + TTL - seconds, slug))
        con.commit()
        con.close()

    with TestClient(app, client=("10.0.0.4", 1)) as c:
        slug = c.post("/api/splits", json={"name": "L", "members": [
            {"name": "A", "upi_id": "a@ybl"}, {"name": "B"}]}).json()["slug"]
        a, b = [m["id"] for m in c.get(f"/api/splits/{slug}").json()["members"]]
        exp = {"paid_by": b, "amount_paise": 1000, "description": "x", "split": "equal", "participants": [a, b]}
        before = c.get(f"/api/splits/{slug}").json()["expires_at"]
        assert c.post(f"/api/splits/{slug}/expenses", json=exp).status_code == 200
        assert c.get(f"/api/splits/{slug}").json()["expires_at"] == before  # use doesn't extend it

        age(slug, TTL + 60)  # ended: readable, UPI IDs hidden, every change refused
        g = c.get(f"/api/splits/{slug}").json()
        assert g["ended"] and g["members"][0]["upi_id"] is None and g["settlement"]
        assert c.post(f"/api/splits/{slug}/expenses", json=exp).status_code == 410
        assert c.post(f"/api/splits/{slug}/members", json={"name": "C"}).status_code == 410
        assert c.get(f"/api/splits/{slug}/qr?to={a}&amount=500").status_code == 410
        assert c.post("/cron/cleanup", headers={"X-Cron-Secret": "s3cret"}).json()["deleted"] == 0

        age(slug, TTL + GRACE + 60)  # gone
        assert c.get(f"/api/splits/{slug}").status_code == 404
        assert c.post("/cron/cleanup", headers={"X-Cron-Secret": "s3cret"}).json()["deleted"] == 1


def test_login_rate_limit():
    with TestClient(app) as c:
        slug = c.post("/api/splits", json={"name": "x", "admin_password": "pass1", "members": [{"name": "A"}]}).json()["slug"]
        codes = [c.post(f"/api/splits/{slug}/admin-login", json={"password": "bad"}).status_code for _ in range(11)]
        assert codes[:10] == [401] * 10 and codes[10] == 429


def test_demo():
    with TestClient(app, client=("10.0.0.5", 1)) as c:
        r = c.post("/api/demo").json()
        g = c.get(f"/api/splits/{r['slug']}").json()
        assert g["admin_id"] == r["admin_id"] == g["members"][0]["id"]
        assert len(g["expenses"]) == 5 and sum(g["balances"].values()) == 0
        assert all(m["upi_id"].endswith("@quicktab") for m in g["members"])
        assert c.delete(f"/api/splits/{r['slug']}", headers={"X-Admin-Token": r["admin_token"]}).status_code == 200


def test_name_and_count():
    from app import db
    with TestClient(app, client=("10.0.0.6", 1)) as c:
        count = lambda: (db.connect().execute("SELECT value FROM stats WHERE key = 'splits'").fetchone() or {"value": 0})["value"]  # noqa: E731
        n = count()
        slug = c.post("/api/splits", json={"members": [{"name": "Admin"}]}).json()["slug"]
        assert count() == n + 1
        assert c.get(f"/api/splits/{slug}").json()["name"] == "Quick tab"


def test_protected():
    with TestClient(app, client=("10.0.0.7", 1)) as c:
        r = c.post("/api/splits", json={"admin_password": "pass1", "members": [{"name": "A"}, {"name": "B"}]}).json()
        slug, admin = r["slug"], {"X-Member-Token": r["admin_token"], "X-Admin-Token": r["admin_token"]}
        g = c.get(f"/api/splits/{slug}").json()
        assert g["protected"] and not g["admin_login"] and not g["open_admin"]
        assert [m["has_password"] for m in g["members"]] == [True, False]
        a, b = [m["id"] for m in g["members"]]
        exp = {"paid_by": b, "amount_paise": 1000, "description": "x", "split": "equal", "participants": [a, b]}
        url = f"/api/splits/{slug}"
        enter = lambda m, **body: c.post(f"{url}/members/{m}/enter", json=body)  # noqa: E731

        # changes need a member session
        assert c.post(f"{url}/expenses", json=exp).status_code == 401
        assert c.post(f"{url}/expenses", json=exp, headers={"X-Member-Token": "forged"}).status_code == 401
        assert c.post(f"{url}/expenses", json=exp, headers=admin).status_code == 200

        # B creates a password on first pick, then has to use it
        assert enter(b, password="ab").status_code == 400  # too short
        tb = enter(b, password="bpass").json()
        assert tb["token"] and tb["admin_token"] is None
        assert enter(b, password="wrong").status_code == 401
        assert enter(b, password="bpass").json()["token"] == tb["token"]
        mine = {"X-Member-Token": tb["token"]}
        assert c.post(f"{url}/expenses", json=exp, headers=mine).status_code == 200

        # the admin's password is their member password too
        assert enter(a, password="pass1").json()["admin_token"] == r["admin_token"]

        # UPI: only yourself or the admin
        assert c.put(f"{url}/members/{b}/upi", json={"upi_id": "b@ybl"}).status_code == 403
        assert c.put(f"{url}/members/{b}/upi", json={"upi_id": "b@ybl"}, headers=mine).status_code == 200
        assert c.put(f"{url}/members/{b}/upi", json={"upi_id": "b2@ybl"}, headers=mine).status_code == 200

        # joining yourself needs a password, a member adding a friend doesn't
        assert c.post(f"{url}/members", json={"name": "D"}).status_code == 400
        assert c.post(f"{url}/members", json={"name": "D", "password": "dpass"}).json()["token"]
        assert c.post(f"{url}/members", json={"name": "E"}, headers=mine).json()["token"] is None

        # admin actions need the admin's session; B's isn't enough
        assert c.delete(f"{url}/members/{b}").status_code == 403
        assert c.delete(url, headers={"X-Admin-Token": tb["token"]}).status_code == 403
        assert c.post(f"{url}/admin-login", json={"password": "pass1"}).json()["admin_token"] == r["admin_token"]
        assert c.delete(url, headers=admin).status_code == 200


def test_capacity():
    with TestClient(app, client=("10.0.0.8", 1)) as c:
        assert c.post("/api/splits", json={"members": [{"name": "A"}, {"name": "B"}], "size": 1}).status_code == 400
        r = c.post("/api/splits", json={"members": [{"name": "A"}], "size": 3}).json()
        url = f"/api/splits/{r['slug']}"
        assert c.get(url).json()["capacity"] == 3
        assert c.post(f"{url}/members", json={"name": "B"}).status_code == 200
        c_id = c.post(f"{url}/members", json={"name": "C"}).json()["id"]
        # full: nobody joins, the admin can't add either
        full = c.post(f"{url}/members", json={"name": "D"})
        assert full.status_code == 400 and "full" in full.json()["detail"]
        assert c.post(f"{url}/members", json={"name": "D"}, headers={"X-Admin-Token": r["admin_token"]}).status_code == 400
        # remove someone, then there's room again
        assert c.delete(f"{url}/members/{c_id}", headers={"X-Admin-Token": r["admin_token"]}).status_code == 200
        assert c.post(f"{url}/members", json={"name": "D"}).status_code == 200


# ---------- accounts ----------

import time  # noqa: E402
from email.message import Message  # noqa: E402
from types import SimpleNamespace  # noqa: E402

import jwt  # noqa: E402
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey  # noqa: E402

from app import main  # noqa: E402

NEON = "https://ep-test.aws.neon.tech"
KEY = Ed25519PrivateKey.generate()


def neon_token(key=KEY, alg="EdDSA", **claims):
    base = {"sub": "user-1", "email": "Riya@Example.com", "name": "Riya", "emailVerified": True,
            "iss": NEON, "aud": NEON, "exp": int(time.time()) + 900}
    return jwt.encode({k: v for k, v in {**base, **claims}.items() if v is not None}, key, algorithm=alg)


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


def use_neon(monkeypatch):
    """Our generated key stands in for Neon's published one."""
    monkeypatch.setattr(main, "JWKS", SimpleNamespace(get_signing_key_from_jwt=lambda t: SimpleNamespace(key=KEY.public_key())))
    monkeypatch.setattr(main, "NEON_ORIGIN", NEON)
    monkeypatch.setattr(main, "NEON_AUTH", NEON + "/neondb/auth")


def test_token_checks(monkeypatch):
    use_neon(monkeypatch)
    with TestClient(app) as c:
        me = lambda t: c.get("/api/me", headers=bearer(t)).status_code  # noqa: E731
        assert me(neon_token(sub="tok-ok")) == 200
        assert c.get("/api/me").status_code == 401
        assert me("not-a-token") == 401
        assert me(neon_token(key=Ed25519PrivateKey.generate(), sub="tok-a")) == 401  # someone else's key
        assert me(neon_token(iss="https://evil.example", sub="tok-b")) == 401
        assert me(neon_token(aud="https://evil.example", sub="tok-c")) == 401
        assert me(neon_token(exp=int(time.time()) - 60, sub="tok-d")) == 401
        assert me(neon_token(exp=None, sub="tok-e")) == 401
        assert me(neon_token(key=None, alg="none", sub="tok-f")) == 401
        assert me(neon_token(key="x" * 32, alg="HS256", sub="tok-g")) == 401
        assert me(neon_token(emailVerified=False, sub="tok-h", email="h@example.com")) == 200  # email and password is enough


def test_profile(monkeypatch):
    use_neon(monkeypatch)
    h = bearer(neon_token(sub="prof-1", email="Prof@Example.com", name="Prof"))
    with TestClient(app) as c:
        # the row is made once, the email is stored lowercase, and no UPI ID is needed
        assert c.get("/api/me", headers=h).json() == {"email": "prof@example.com", "name": "Prof", "upi_id": None}
        assert c.get("/api/me", headers=h).status_code == 200
        assert c.patch("/api/me", json={"upi_id": "prof@okaxis"}, headers=h).json()["upi_id"] == "prof@okaxis"
        assert c.patch("/api/me", json={"upi_id": "nope"}, headers=h).status_code == 422
        assert c.patch("/api/me", json={"name": "   "}, headers=h).status_code == 400
        # changing the name leaves the UPI ID alone, null clears it
        assert c.patch("/api/me", json={"name": " New "}, headers=h).json() == {"email": "prof@example.com", "name": "New", "upi_id": "prof@okaxis"}
        con = main.db.connect()
        stored = con.execute("SELECT upi_id FROM users WHERE id = 'prof-1'").fetchone()["upi_id"]
        con.close()
        assert "okaxis" not in stored
        assert c.patch("/api/me", json={"upi_id": None}, headers=h).json()["upi_id"] is None
        assert c.delete("/api/me", headers=h).status_code == 200
        # a new Neon account for the same email replaces a row Neon no longer knows
        c.get("/api/me", headers=h)
        again = bearer(neon_token(sub="prof-2", email="prof@example.com"))
        assert c.get("/api/me", headers=again).status_code == 200


def test_auth_proxy(monkeypatch):
    use_neon(monkeypatch)
    seen = {}

    def fake_neon(method, path, body, headers):
        seen.update(method=method, path=path, body=body, headers=headers)
        got = Message()
        got["content-type"] = "application/json"
        got.add_header("set-cookie", "__Secure-neon-auth.session_token=abc; Path=/; Domain=ep-test.aws.neon.tech; HttpOnly; Secure; SameSite=None; Partitioned")
        got.add_header("set-cookie", "other=1; path=/neondb/auth; HttpOnly")
        return 401, got, b'{"message":"Invalid email or password"}'

    monkeypatch.setattr(main, "neon_call", fake_neon)
    with TestClient(app) as c:
        r = c.post("/auth/sign-in/email", json={"email": "a@b.co", "password": "x"}, headers={"Origin": "https://quicktabapp.vercel.app"})
        # Neon's answer comes back as is, and its cookies become this site's
        assert r.status_code == 401 and r.json()["message"] == "Invalid email or password"
        assert r.headers["cache-control"] == "no-store"
        cookies = r.headers.get_list("set-cookie")
        assert len(cookies) == 2 and not any("domain" in x.lower() for x in cookies)
        assert all("Path=/auth" in x for x in cookies) and "HttpOnly" in cookies[0]
        assert seen["path"] == "sign-in/email" and seen["headers"]["origin"] == "https://quicktabapp.vercel.app"
        # plain http locally: no secure cookie, which browsers would refuse, and Neon still gets its own name back
        assert cookies[0].startswith("neon-auth.session_token=abc") and "Secure" not in cookies[0] and "Partitioned" not in cookies[0] and "SameSite=Lax" in cookies[0]
        c.get("/auth/token", headers={"Cookie": "neon-auth.session_token=abc"})
        assert seen["headers"]["cookie"] == "__Secure-neon-auth.session_token=abc"
        # on Vercel, https: untouched apart from the domain and path
        monkeypatch.setenv("VERCEL", "1")
        https = c.post("/auth/sign-in/email", json={}).headers.get_list("set-cookie")[0]
        assert https.startswith("__Secure-neon-auth.session_token=abc") and "Secure" in https and "SameSite=None" in https
        c.get("/auth/token", headers={"Cookie": "__Secure-neon-auth.session_token=abc"})
        assert seen["headers"]["cookie"] == "__Secure-neon-auth.session_token=abc"
        monkeypatch.delenv("VERCEL")
        # only the routes we use are forwarded
        for path in ("admin/list-users", "update-user", "sign-in/../admin/list-users"):
            assert c.post(f"/auth/{path}", json={}).status_code == 404
        def down(*a):
            raise ConnectionResetError

        monkeypatch.setattr(main, "neon_call", down)
        assert c.post("/auth/sign-in/email", json={}).status_code == 502
        monkeypatch.setattr(main, "NEON_AUTH", "")
        assert c.post("/auth/sign-in/email", json={}).status_code == 503


def test_auth_rate_limit(monkeypatch):
    use_neon(monkeypatch)
    monkeypatch.setattr(main, "neon_call", lambda *a: (200, Message(), b"{}"))
    main.HITS.clear()
    with TestClient(app) as c:
        codes = [c.post("/auth/sign-in/email", json={}).status_code for _ in range(main.AUTH_LIMIT[0] + 1)]
    main.HITS.clear()
    assert codes[-1] == 429 and set(codes[:-1]) == {200}


# ---------- friends ----------

def person(c, sub, email, name):
    h = bearer(neon_token(sub=sub, email=email, name=name))
    assert c.get("/api/me", headers=h).status_code == 200
    return h


def test_friends(monkeypatch):
    use_neon(monkeypatch)
    sent = []
    monkeypatch.setattr(main, "send_email", lambda to, subject, text: sent.append((to, subject, text)))
    with TestClient(app) as c:
        a, b = person(c, "f-a", "a@friends.test", "Asha"), person(c, "f-b", "b@friends.test", "Bilal")
        get = lambda h: c.get("/api/friends", headers=h).json()  # noqa: E731
        assert c.post("/api/friends", json={"email": "A@friends.test"}, headers=a).status_code == 400  # yourself
        assert c.post("/api/friends", json={"email": "nope"}, headers=a).status_code == 422
        assert c.post("/api/friends", json={"email": "x@friends.test"}).status_code == 401
        # an account or not, the answer and the email are the same
        known = c.post("/api/friends", json={"email": "B@Friends.test"}, headers=a)
        unknown = c.post("/api/friends", json={"email": "new@friends.test"}, headers=a)
        assert known.json() == unknown.json() == {"ok": True} and known.status_code == unknown.status_code
        assert [s[0] for s in sent] == ["b@friends.test", "new@friends.test"] and sent[0][1] == "Asha wants to split bills with you on QuickTab"
        # the sender sees only the address they typed, never a name, until it's accepted
        assert get(a)["sent"] == [{"id": get(a)["sent"][0]["id"], "email": "new@friends.test"}, {"id": get(a)["sent"][1]["id"], "email": "b@friends.test"}]
        rid = get(b)["requests"][0]["id"]
        assert get(b)["requests"] == [{"id": rid, "name": "Asha", "email": "a@friends.test"}]
        # only the person asked can answer
        assert c.post(f"/api/friends/{rid}/accept", headers=a).status_code == 404
        stranger = person(c, "f-s", "s@friends.test", "Sam")
        assert c.post(f"/api/friends/{rid}/accept", headers=stranger).status_code == 404
        assert c.delete(f"/api/friends/{rid}", headers=stranger).status_code == 404
        assert c.delete(f"/api/friends/{rid}", headers=b).status_code == 404  # a request is declined, not deleted
        assert c.post(f"/api/friends/{rid}/accept", headers=b).status_code == 200
        assert c.post(f"/api/friends/{rid}/accept", headers=b).status_code == 404  # only once
        assert get(a)["friends"] == [{"id": rid, "name": "Bilal", "email": "b@friends.test"}]
        assert get(b)["friends"] == [{"id": rid, "name": "Asha", "email": "a@friends.test"}]
        # a repeat is quiet: no second row, no second email
        count = len(sent)
        c.post("/api/friends", json={"email": "b@friends.test"}, headers=a)
        assert len(sent) == count and len(get(a)["friends"]) == 1
        # someone invited before they had an account finds it waiting
        new = person(c, "f-n", "new@friends.test", "Nia")
        assert [r["name"] for r in get(new)["requests"]] == ["Asha"]
        # declining tells the sender nothing
        wid = get(new)["requests"][0]["id"]
        assert c.post(f"/api/friends/{wid}/decline", headers=new).status_code == 200
        assert get(new)["requests"] == [] and get(a)["sent"] == [{"id": wid, "email": "new@friends.test"}]
        # asking back after a decline, or after being asked, is a yes
        assert c.post("/api/friends", json={"email": "a@friends.test"}, headers=new).status_code == 200
        assert {f["name"] for f in get(a)["friends"]} == {"Bilal", "Nia"} and get(a)["sent"] == []
        # either side can remove a friend
        assert c.delete(f"/api/friends/{wid}", headers=new).status_code == 200
        assert {f["name"] for f in get(a)["friends"]} == {"Bilal"}
        # cancel and resend can't pester anyone: the request comes back, the email doesn't
        c.post("/api/friends", json={"email": "z@friends.test"}, headers=a)
        count = len(sent)
        zid = get(a)["sent"][0]["id"]
        assert c.delete(f"/api/friends/{zid}", headers=a).status_code == 200
        c.post("/api/friends", json={"email": "z@friends.test"}, headers=a)
        assert len(sent) == count and get(a)["sent"][0]["email"] == "z@friends.test"
        # deleting an account removes them from everyone's list
        assert c.delete("/api/me", headers=b).status_code == 200
        assert get(a)["friends"] == []


def test_friend_daily_limit(monkeypatch):
    use_neon(monkeypatch)
    monkeypatch.setattr(main, "send_email", lambda *a: None)
    with TestClient(app) as c:
        h = person(c, "f-lim", "lim@friends.test", "Lim")
        codes = [c.post("/api/friends", json={"email": f"p{i}@friends.test"}, headers=h).status_code for i in range(main.FRIEND_LIMIT[0] + 1)]
        assert codes[-1] == 429 and set(codes[:-1]) == {200}
        # the window ends
        con = main.db.connect()
        con.execute("UPDATE rate_limits SET window_start = 0 WHERE key = 'friends:f-lim'")
        con.commit()
        con.close()
        assert c.post("/api/friends", json={"email": "later@friends.test"}, headers=h).status_code == 200


def test_send_email_never_fails_a_request(monkeypatch):
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    main.send_email("a@b.co", "s", "t")  # no key: nothing happens
    monkeypatch.setenv("RESEND_API_KEY", "k")
    monkeypatch.setenv("EMAIL_FROM", "QuickTab <hi@example.com>")

    def down(*a, **k):
        raise OSError

    monkeypatch.setattr(main, "urlopen", down)
    main.send_email("a@b.co", "s", "t")


def befriend(c, a, b, b_email):
    """a asks b, b accepts. Returns the friend row id (the same for both sides)."""
    c.post("/api/friends", json={"email": b_email}, headers=a)
    rid = c.get("/api/friends", headers=b).json()["requests"][0]["id"]
    assert c.post(f"/api/friends/{rid}/accept", headers=b).status_code == 200
    return rid


def test_groups(monkeypatch):
    use_neon(monkeypatch)
    monkeypatch.setattr(main, "send_email", lambda *a: None)
    main.HITS.clear()  # the per-IP write limit is shared by every test
    with TestClient(app) as c:
        o = person(c, "g-o", "o@groups.test", "Owner")
        f = person(c, "g-f", "f@groups.test", "Fatima")
        x = person(c, "g-x", "x@groups.test", "Xavier")  # signed in, but not in the group
        rid = befriend(c, o, f, "f@groups.test")
        assert c.post("/api/groups", json={"name": "Flat 4B", "friend_ids": [999]}, headers=o).status_code == 404  # not a friend
        assert c.post("/api/groups", json={"name": "Flat 4B"}).status_code == 401
        slug = c.post("/api/groups", json={"name": "Flat 4B", "friend_ids": [rid]}, headers=o).json()["slug"]
        base = f"/api/splits/{slug}"

        g = c.get(base, headers=f).json()
        owner_id, fatima = [m["id"] for m in g["members"]]
        assert g["group"] and g["me"] == fatima and g["admin_id"] == owner_id and not g["ended"]
        assert c.get(base, headers=o).json()["me"] == owner_id

        # outsiders and signed-out visitors see nothing, through every route
        expense = {"paid_by": owner_id, "amount_paise": 900, "description": "Milk", "split": "equal", "participants": [owner_id, fatima]}
        for h in ({}, x):
            assert c.get(base, headers=h).status_code == 404
            assert c.get(f"{base}/qr?to={owner_id}&amount=100", headers=h).status_code == 404
            assert c.post(f"{base}/expenses", json=expense, headers=h).status_code == 404
            assert c.post(f"{base}/members", json={"name": "Sneaky"}, headers=h).status_code == 404  # no joining by link
            assert c.put(f"{base}/members/{owner_id}/upi", json={"upi_id": "evil@ybl"}, headers=h).status_code == 404
            assert c.post(f"{base}/members/{owner_id}/enter", json={"password": "x"}, headers=h).status_code == 404
            assert c.post(f"{base}/admin-login", json={"password": "x"}, headers=h).status_code == 404
            assert c.delete(base, headers=h).status_code == 404
        assert c.get(base, headers=bearer("not-a-token")).status_code == 401

        # members split expenses as usual; the ledger says who did what
        assert c.post(f"{base}/expenses", json=expense, headers=f).status_code == 200
        assert c.get(base, headers=o).json()["activity"][0]["details"]["by"] == "Fatima"
        # a payment can only be recorded by the payer or the person paid
        pay = {"paid_by": fatima, "amount_paise": 450, "description": "Fatima paid Owner · Cash", "split": "exact",
               "shares": {str(owner_id): 450}, "kind": "payment"}
        assert c.post(f"{base}/expenses", json=pay, headers=f).status_code == 200

        main.HITS.clear()
        # only the owner runs the group
        assert c.delete(f"{base}/members/{fatima}", headers=f).status_code == 403
        assert c.delete(base, headers=f).status_code == 403

        groups = c.get("/api/groups", headers=f).json()
        assert [(gr["name"], gr["spent"], gr["balance"], gr["members"]) for gr in groups] == [("Flat 4B", 900, 0, ["Owner", "Fatima"])]
        assert c.get("/api/groups", headers=x).json() == []
        assert [a["group_name"] for a in c.get("/api/me/activity", headers=f).json()][-1] == "Flat 4B"
        assert c.get("/api/me/activity", headers=x).json() == []

        # members bring in their own friends, once
        xid = befriend(c, f, x, "x@groups.test")
        assert c.post(f"/api/groups/{slug}/members", json={"friend_id": xid}, headers=o).status_code == 404  # not the owner's friend
        assert c.post(f"/api/groups/{slug}/members", json={"friend_id": xid}, headers=f).status_code == 200
        assert c.post(f"/api/groups/{slug}/members", json={"friend_id": xid}, headers=f).status_code == 400
        assert c.get(base, headers=x).status_code == 200

        # your profile is you in every group
        c.patch("/api/me", json={"name": "Fatima K", "upi_id": "fatima@okaxis"}, headers=f)
        me = next(m for m in c.get(base, headers=o).json()["members"] if m["id"] == fatima)
        assert (me["name"], me["upi_id"]) == ("Fatima K", "fatima@okaxis")

        # groups outlive the cleanup job
        assert c.post("/cron/cleanup", headers={"X-Cron-Secret": "s3cret"}).status_code == 200
        assert c.get(base, headers=o).status_code == 200

        # deleting the owner's account hands the group on, and their rows stay for the balances
        assert c.delete("/api/me", headers=o).status_code == 200
        g = c.get(base, headers=f).json()
        assert g["admin_id"] == fatima and g["members"][0]["name"] == "Deleted user"
        assert c.delete(base, headers=f).status_code == 200
        assert c.get(base, headers=f).status_code == 404

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
        assert c.get(f"/api/splits/{slug}").json()["name"] == "Quick split"


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

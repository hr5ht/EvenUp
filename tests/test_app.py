import os
import tempfile

os.environ["EVENUP_DB"] = os.path.join(tempfile.mkdtemp(), "test.db")
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
        r = c.post("/api/splits", json={"name": "Dinner", "admin_password": "pass1", "members": [
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

        # admin login: wrong password, right password gives the same token create returned
        assert c.post(f"/api/splits/{slug}/admin-login", json={"password": "nope"}).status_code == 401
        assert c.post(f"/api/splits/{slug}/admin-login", json={"password": "pass1"}).json()["admin_token"] == token

        # anyone can join; names stay unique
        assert c.post(f"/api/splits/{slug}/members", json={"name": "D"}).status_code == 200
        assert c.post(f"/api/splits/{slug}/members", json={"name": "d"}).status_code == 400

        # UPI ID: set once by anyone, changing it needs the admin
        upi = lambda m, v, h=None: c.put(f"/api/splits/{slug}/members/{m}/upi", json={"upi_id": v}, headers=h or {})  # noqa: E731
        assert upi(b, "b@ybl").status_code == 200
        assert upi(b, "thief@ybl").status_code == 403
        assert upi(b, "b2@ybl", {"X-Admin-Token": token}).status_code == 200
        assert [m["upi_id"] for m in c.get(f"/api/splits/{slug}").json()["members"] if m["id"] == b] == ["b2@ybl"]

        # admin actions need the token

        # remove member: blocked while in a live expense, allowed otherwise
        adm = {"X-Admin-Token": token}
        assert c.delete(f"/api/splits/{slug}/members/{b}", headers=adm).status_code == 400
        assert c.delete(f"/api/splits/{slug}/members/{a}", headers=adm).json()["detail"] == "The admin can't be removed"
        assert c.delete(f"/api/splits/{slug}/members/{cc}").status_code == 403
        assert c.delete(f"/api/splits/{slug}/members/{cc}", headers=adm).status_code == 200
        assert len(c.get(f"/api/splits/{slug}").json()["members"]) == 3
        assert c.delete(f"/api/splits/{slug}", headers={"X-Admin-Token": "wrong"}).status_code == 403
        assert c.delete(f"/api/splits/{slug}", headers={"X-Admin-Token": token}).status_code == 200
        assert c.get(f"/api/splits/{slug}").status_code == 404


def test_cross_split_access_and_guards():
    with TestClient(app) as c:
        s1 = c.post("/api/splits", json={"name": "One", "admin_password": "pass1", "members": [{"name": "A"}]}).json()["slug"]
        s2 = c.post("/api/splits", json={"name": "Two", "admin_password": "pass1", "members": [{"name": "B"}]}).json()["slug"]
        a = c.get(f"/api/splits/{s1}").json()["members"][0]["id"]
        eid = c.post(f"/api/splits/{s1}/expenses", json={
            "paid_by": a, "amount_paise": 100, "description": "x", "split": "equal", "participants": [a]}).json()["id"]
        # expense of split 1 can't be touched through split 2
        assert c.delete(f"/api/splits/{s2}/expenses/{eid}").status_code == 404
        # honeypot, duplicate names, bad UPI
        assert c.post("/api/splits", json={"name": "x", "admin_password": "pass1", "members": [{"name": "A"}], "website": "spam"}).status_code == 400
        assert c.post("/api/splits", json={"name": "x", "admin_password": "pass1", "members": [{"name": "A"}, {"name": "a"}]}).status_code == 400
        assert c.post("/api/splits", json={"name": "x", "admin_password": "pass1", "members": [{"name": "A", "upi_id": "nope"}]}).status_code == 422
        # cron needs the secret; demo survives cleanup
        assert c.post("/cron/cleanup").status_code == 403
        assert c.post("/cron/cleanup", headers={"X-Cron-Secret": "s3cret"}).status_code == 200
        assert c.get("/api/splits/demo").status_code == 200
        assert "Content-Security-Policy" in c.get("/").headers


def test_settle_up_payment():
    with TestClient(app, client=("10.0.0.2", 1)) as c:
        slug = c.post("/api/splits", json={"name": "P", "admin_password": "pass1", "members": [{"name": "A"}, {"name": "B"}]}).json()["slug"]
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
        codes = [c.post("/api/splits", json={"name": "x", "admin_password": "pass1", "members": [{"name": "A"}]}).status_code for _ in range(11)]
        assert codes[:10] == [200] * 10 and codes[10] == 429


def test_upi_encrypted_at_rest():
    from app import db
    with TestClient(app) as c:
        slug = c.post("/api/splits", json={"name": "x", "admin_password": "pass1", "members": [{"name": "A", "upi_id": "secret@ybl"}]}).json()["slug"]
        assert c.get(f"/api/splits/{slug}").json()["members"][0]["upi_id"] == "secret@ybl"
        con = db.connect()
        stored = con.execute("SELECT upi_id FROM members WHERE name = 'A' ORDER BY id DESC").fetchone()[0]
        con.close()
        assert "secret" not in stored


def test_qr():
    from app.main import upi_link
    assert upi_link("a@ybl", "Aman K", 12345, "Goa trip") == "upi://pay?pa=a@ybl&pn=Aman%20K&am=123.45&cu=INR&tn=Goa%20trip"
    with TestClient(app) as c:
        g = c.get("/api/splits/demo").json()
        aman, _, kabir = [m["id"] for m in g["members"]]
        r = c.get(f"/api/splits/demo/qr?to={aman}&amount=80000")
        assert r.status_code == 200 and r.headers["content-type"].startswith("image/svg+xml")
        assert c.get(f"/api/splits/demo/qr?to={kabir}&amount=100").status_code == 404  # no UPI ID


def test_login_rate_limit_and_demo():
    with TestClient(app) as c:
        slug = c.post("/api/splits", json={"name": "x", "admin_password": "pass1", "members": [{"name": "A"}]}).json()["slug"]
        codes = [c.post(f"/api/splits/{slug}/admin-login", json={"password": "bad"}).status_code for _ in range(11)]
        assert codes[:10] == [401] * 10 and codes[10] == 429
        token = c.post("/api/splits/demo/admin-login", json={"password": "demo"}).json()["admin_token"]
        assert c.delete("/api/splits/demo", headers={"X-Admin-Token": token}).status_code == 400

import os
import sqlite3

# ponytail: SQLite file, swap for Postgres when hosting needs a persistent managed DB
DB_PATH = os.environ.get("EVENUP_DB", "evenup.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS splits (
    id INTEGER PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    admin_pw_hash TEXT NOT NULL,
    admin_member_id INTEGER,  -- the creator, always a member of the group
    last_activity_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY,
    split_id INTEGER NOT NULL REFERENCES splits(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    upi_id TEXT
);
CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY,
    split_id INTEGER NOT NULL REFERENCES splits(id) ON DELETE CASCADE,
    paid_by INTEGER NOT NULL REFERENCES members(id),
    amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
    description TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    deleted INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS shares (
    expense_id INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
    member_id INTEGER NOT NULL REFERENCES members(id),
    share_paise INTEGER NOT NULL CHECK (share_paise >= 0),
    PRIMARY KEY (expense_id, member_id)
);
CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY,
    split_id INTEGER NOT NULL REFERENCES splits(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    expense_id INTEGER,
    details TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
"""


def connect():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    return con


def init():
    con = connect()
    con.executescript(SCHEMA)
    con.close()


def get_db():
    # Handlers commit explicitly so writes land before the response is sent.
    con = connect()
    try:
        yield con
    finally:
        con.close()

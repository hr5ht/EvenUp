import os
import sqlite3

# Postgres (Neon) when DATABASE_URL is set, as on Vercel; a local SQLite file otherwise (dev and tests).
DATABASE_URL = os.environ.get("DATABASE_URL")
DB_PATH = os.environ.get("EVENUP_DB", "evenup.db")

# Same SQL for both databases; only the auto-increment key differs ({pk}).
# Money and times are BIGINT: paise can pass 2^31 in Postgres.
SCHEMA = """
CREATE TABLE IF NOT EXISTS splits (
    id {pk},
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    admin_pw_hash TEXT NOT NULL,
    admin_member_id INTEGER,  -- the creator, always a member of the group
    last_activity_at BIGINT NOT NULL,  -- unused since the lifetime became fixed, kept so existing databases match
    expires_at BIGINT NOT NULL,  -- end of the open phase, then read-only for a day, then deleted
    created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
    id {pk},
    split_id INTEGER NOT NULL REFERENCES splits(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    upi_id TEXT,
    pw_hash TEXT  -- password protected splits only, set by the member the first time they pick their name
);
CREATE TABLE IF NOT EXISTS expenses (
    id {pk},
    split_id INTEGER NOT NULL REFERENCES splits(id) ON DELETE CASCADE,
    -- Members are only deleted with their split, or once no live expense uses them, so cascading is safe.
    -- Postgres needs it: it checks these links mid-way through a split's cascade, before shares are gone.
    paid_by INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
    description TEXT NOT NULL,
    -- payment = a settle-up: paid_by hands money to the one member in shares
    kind TEXT NOT NULL DEFAULT 'expense' CHECK (kind IN ('expense', 'payment')),
    version INTEGER NOT NULL DEFAULT 1,
    deleted INTEGER NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS shares (
    expense_id INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    share_paise BIGINT NOT NULL CHECK (share_paise >= 0),
    PRIMARY KEY (expense_id, member_id)
);
CREATE TABLE IF NOT EXISTS activity (
    id {pk},
    split_id INTEGER NOT NULL REFERENCES splits(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    expense_id INTEGER,
    details TEXT NOT NULL,
    created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS stats (
    key TEXT PRIMARY KEY,  -- splits, demos: how many were ever created, since splits delete themselves
    value BIGINT NOT NULL
);
"""
# Columns added after launch, for databases created before them.
NEW_COLUMNS = {"members": [("pw_hash", "TEXT")]}


class PgConnection:
    """Just enough of sqlite3.Connection over psycopg: ? placeholders and rows readable by column name."""

    def __init__(self, con):
        self.con = con

    def execute(self, sql, params=()):
        return self.con.execute(sql.replace("?", "%s"), params)

    def executemany(self, sql, rows):
        self.con.cursor().executemany(sql.replace("?", "%s"), rows)

    def commit(self):
        self.con.commit()

    def close(self):
        self.con.close()


def connect():
    if DATABASE_URL:
        import psycopg
        from psycopg.rows import dict_row
        return PgConnection(psycopg.connect(DATABASE_URL, row_factory=dict_row))
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    return con


def init():
    con = connect()
    schema = SCHEMA.format(pk="SERIAL PRIMARY KEY" if DATABASE_URL else "INTEGER PRIMARY KEY")
    for statement in schema.split(";"):
        if statement.strip():
            con.execute(statement)
    for table, cols in NEW_COLUMNS.items():
        have = [d[0] for d in con.execute(f"SELECT * FROM {table} LIMIT 0").description]
        for col, kind in cols:
            if col not in have:
                con.execute(f"ALTER TABLE {table} ADD COLUMN {col} {kind}")
    con.commit()
    con.close()


def get_db():
    # Handlers commit explicitly so writes land before the response is sent.
    con = connect()
    try:
        yield con
    finally:
        con.close()

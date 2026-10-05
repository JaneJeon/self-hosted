#!/usr/bin/env python3
"""Project a consistent GOWA restore into a new query-only trial archive."""

import argparse
import datetime
import hashlib
import json
import os
import pathlib
import shutil
import sqlite3
import tempfile

FIELDS = (
    "id",
    "chat_jid",
    "sender",
    "content",
    "timestamp",
    "is_from_me",
    "media_type",
    "filename",
)
SCHEMA = """
CREATE TABLE chats(jid TEXT PRIMARY KEY,name TEXT,last_message_time TIMESTAMP,last_read_time TIMESTAMP);
CREATE TABLE messages(id TEXT,chat_jid TEXT,sender TEXT,content TEXT,timestamp TIMESTAMP,is_from_me BOOLEAN,media_type TEXT,filename TEXT,quoted_message_id TEXT,PRIMARY KEY(id,chat_jid),FOREIGN KEY(chat_jid) REFERENCES chats(jid));
CREATE INDEX idx_messages_chat_jid ON messages(chat_jid);
"""


def readonly(path):
    return sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)


def seed(source, destination, snapshot, timestamp):
    destination = destination.absolute()
    if any(path.is_symlink() for path in (destination, *destination.parents)):
        raise ValueError("Destination has a symlink ancestor")
    source, destination = source.resolve(), destination.resolve()
    if destination.exists() or source == destination or source in destination.parents:
        raise ValueError("Destination must be new and outside the source")
    if len(snapshot) != 8 or any(c not in "0123456789abcdef" for c in snapshot):
        raise ValueError("Expected the reviewed eight-character restic snapshot ID")
    date = datetime.datetime.fromisoformat(timestamp)
    if date.utcoffset() is None:
        raise ValueError("Snapshot timestamp requires a timezone")
    with readonly(source / "storages/whatsapp.db") as contacts, readonly(
        source / "storages/chatstorage.db"
    ) as history:
        for db in (contacts, history):
            if db.execute("PRAGMA quick_check").fetchone() != ("ok",):
                raise ValueError("Source database failed quick_check")
        if contacts.execute("SELECT count(*) FROM whatsmeow_device").fetchone()[0] != 1:
            raise ValueError("Expected exactly one source device")
        identities = history.execute(
            "SELECT device_id FROM chats UNION SELECT device_id FROM messages"
        ).fetchall()
        if len(identities) != 1:
            raise ValueError("Expected exactly one history device")
        device = identities[0][0]
        contact_rows = contacts.execute(
            "SELECT their_jid,full_name,push_name,first_name,business_name FROM whatsmeow_contacts"
        ).fetchall()
        lid_rows = contacts.execute("SELECT lid,pn FROM whatsmeow_lid_map").fetchall()
        names = {
            jid: full or push or first or business
            for jid, full, push, first, business in contact_rows
        }
        chats = history.execute(
            "SELECT jid,name,last_message_time FROM chats WHERE device_id=? ORDER BY jid",
            (device,),
        ).fetchall()
        has_quotes = "quoted_message_id" in {
            row[1] for row in history.execute("PRAGMA table_info(messages)")
        }
        quote_field = "quoted_message_id" if has_quotes else "NULL AS quoted_message_id"
        messages = history.execute(
            "SELECT "
            + ",".join(FIELDS)
            + ","
            + quote_field
            + " FROM messages WHERE device_id=? ORDER BY chat_jid,id",
            (device,),
        ).fetchall()
        destination.parent.mkdir(parents=True, exist_ok=True)
        stage = pathlib.Path(
            tempfile.mkdtemp(prefix="whatsapp-query-seed-", dir=destination.parent)
        )
        try:
            with sqlite3.connect(stage / "messages.db") as target:
                target.execute("PRAGMA foreign_keys=ON")
                target.executescript(SCHEMA)
                for jid, name, time in chats:
                    datetime.datetime.fromisoformat(time)
                    if not jid.endswith("@g.us") and names.get(jid):
                        name = names[jid]
                    target.execute(
                        "INSERT INTO chats(jid,name,last_message_time) VALUES(?,?,?)",
                        (jid, name, time),
                    )
                for row in messages:
                    datetime.datetime.fromisoformat(row[4])
                    target.execute(
                        "INSERT INTO messages("
                        + ",".join(FIELDS)
                        + ",quoted_message_id) VALUES(?,?,?,?,?,?,?,?,?)",
                        row,
                    )
                if target.execute("PRAGMA foreign_key_check").fetchall():
                    raise ValueError("Trial history has broken chat references")
            with sqlite3.connect(stage / "contacts.db") as target:
                target.executescript(
                    "CREATE TABLE whatsmeow_contacts(their_jid TEXT,full_name TEXT,push_name TEXT,first_name TEXT,business_name TEXT); CREATE TABLE whatsmeow_lid_map(lid TEXT,pn TEXT);"
                )
                target.executemany(
                    "INSERT INTO whatsmeow_contacts VALUES(?,?,?,?,?)", contact_rows
                )
                target.executemany(
                    "INSERT INTO whatsmeow_lid_map VALUES(?,?)", lid_rows
                )
            manifest = {
                "snapshot": snapshot,
                "time": date.isoformat(),
                "live_whatsapp": False,
                "chats": len(chats),
                "messages": len(messages),
                "contacts": len(contact_rows),
                "lid_mappings": len(lid_rows),
                "paired_device_keys_included": False,
                "quoted_message_id_source_present": has_quotes,
                "sha256": {},
            }
            for name in ("messages.db", "contacts.db"):
                with readonly(stage / name) as db:
                    if db.execute("PRAGMA quick_check").fetchone() != ("ok",):
                        raise ValueError("Trial database failed quick_check")
                manifest["sha256"][name] = hashlib.sha256(
                    (stage / name).read_bytes()
                ).hexdigest()
            (stage / "snapshot.json").write_text(json.dumps(manifest, indent=2) + "\n")
            (stage / ".snapshot-ready").touch()
            for file in stage.iterdir():
                os.chmod(file, 0o600)
            stage.rename(destination)
        except BaseException:
            shutil.rmtree(stage)
            raise
    return {key: value for key, value in manifest.items() if key != "sha256"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=pathlib.Path)
    parser.add_argument("destination", type=pathlib.Path)
    parser.add_argument("--snapshot", required=True)
    parser.add_argument("--time", required=True)
    args = parser.parse_args()
    print(
        json.dumps(
            seed(args.source, args.destination, args.snapshot, args.time), indent=2
        )
    )

#!/usr/bin/env python3
"""Export a stopped upstream WhatsApp installation for the Railway volume."""

import argparse
import os
import shutil
import sqlite3
from pathlib import Path

DATABASES = ("whatsapp.db", "chatstorage.db")


def export(source: Path, destination: Path) -> None:
    storages = source / "storages"
    statics = source / "statics"
    if not storages.is_dir() or not statics.is_dir():
        raise SystemExit("source must contain storages and statics directories")
    if {path.name for path in storages.glob("*.db")} != set(DATABASES):
        raise SystemExit("unexpected SQLite database set; inspect before exporting")
    if destination.exists() and any(destination.iterdir()):
        raise SystemExit("destination must be empty to avoid stale state")

    os.umask(0o077)
    destination.mkdir(parents=True, exist_ok=True)

    def ignore_database_files(directory: str, names: list[str]) -> list[str]:
        if Path(directory) != storages:
            return []
        return [
            name
            for name in names
            if any(
                name == database or name.startswith(database + "-")
                for database in DATABASES
            )
        ]

    shutil.copytree(storages, destination / "storages", ignore=ignore_database_files)
    shutil.copytree(statics, destination / "statics")

    for name in DATABASES:
        source_db = sqlite3.connect((storages / name).as_uri() + "?mode=ro", uri=True)
        destination_db = sqlite3.connect(destination / "storages" / name)
        try:
            source_db.backup(destination_db)
            if destination_db.execute("PRAGMA quick_check").fetchone() != ("ok",):
                raise SystemExit(f"integrity check failed for {name}")
        finally:
            destination_db.close()
            source_db.close()

    print("Exported both validated SQLite databases, other state, and media")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="upstream src directory")
    parser.add_argument("destination", type=Path, help="new empty export directory")
    args = parser.parse_args()
    export(args.source.resolve(), args.destination.resolve())

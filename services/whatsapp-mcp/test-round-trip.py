import hashlib
import http.server
import json
import os
import pathlib
import sqlite3
import subprocess
import sys
import tempfile
import threading
import uuid

image = os.environ.get("BACKUP_TEST_IMAGE", "whatsapp-backup-test")
test_id = uuid.uuid4().hex[:8]
heartbeats = []


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/success":
            heartbeats.append(self.path)
            self.send_response(200)
        else:
            self.send_response(503)
        self.end_headers()
        self.wfile.write(b'{"ok":true}')

    def log_message(self, *args):
        pass


def run(args, **kwargs):
    result = subprocess.run(args, capture_output=True, text=True, **kwargs)
    if result.returncode:
        raise RuntimeError(
            f"exit {result.returncode}: {result.stderr[:2000]} {result.stdout[-1000:]}"
        )
    return result.stdout


server = http.server.ThreadingHTTPServer(("0.0.0.0", 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    with tempfile.TemporaryDirectory(prefix="whatsapp-backup-test-") as root:
        root = pathlib.Path(root)
        data, repo = root / "data", root / "repo"
        storages, media = data / "storages", data / "statics/media"
        storages.mkdir(parents=True)
        media.mkdir(parents=True)
        repo.mkdir()
        writers = []
        for name in ["whatsapp", "chatstorage"]:
            writer = sqlite3.connect(storages / f"{name}.db")
            writer.execute("PRAGMA journal_mode=WAL")
            writer.execute("PRAGMA wal_autocheckpoint=0")
            writer.execute("CREATE TABLE fixture(id INTEGER PRIMARY KEY, value TEXT)")
            writer.executemany(
                "INSERT INTO fixture VALUES (?,?)", [(1, name), (2, "WAL")]
            )
            writer.commit()
            writers.append(writer)
        (storages / "state-fixture").write_bytes(b"fixture state")
        (media / "media-fixture").write_bytes(b"fixture media")
        (storages / ".whatsapp-backup-last-success").write_text("0\n")

        common = [
            "docker",
            "run",
            "--rm",
            "--user",
            f"{os.getuid()}:{os.getgid()}",
            "--label",
            "codex.whatsapp-backup-test=" + test_id,
            "-v",
            f"{data}:/app/data",
            "-v",
            f"{repo}:/repo",
            "-e",
            "RESTIC_REPOSITORY=/repo",
            "-e",
            "RESTIC_PASSWORD=fixture",
            "-e",
            "RESTIC_CACHE_DIR=/tmp/cache",
        ]
        if sys.platform == "linux":
            common += ["--add-host", "host.docker.internal:host-gateway"]
        restic = common + ["--entrypoint", "restic", image]
        run(restic + ["init"], timeout=30)

        def backup(path):
            return common + [
                "-e",
                "B2_ACCOUNT_ID=fixture",
                "-e",
                "B2_ACCOUNT_KEY=fixture",
                "-e",
                f"HEARTBEAT_URL=http://host.docker.internal:{server.server_port}/{path}",
                "--entrypoint",
                "sh",
                image,
                "-c",
                "exec /usr/local/bin/backup.sh",
            ]

        run(backup("success"), timeout=90)
        snapshots = json.loads(run(restic + ["snapshots", "--json"], timeout=30))
        assert len(snapshots) == 1 and len(heartbeats) == 1
        checks = run(
            common
            + [
                "--entrypoint",
                "sh",
                image,
                "-c",
                """
            set -eu
            restic restore latest --target /tmp/restore >/dev/null
            stage=/tmp/restore/tmp/whatsapp-backup/whatsapp-mcp
            for db in whatsapp chatstorage; do
                test ! -e "$stage/storages/$db.db-wal"
                test ! -e "$stage/storages/$db.db-shm"
                sqlite3 -readonly "$stage/storages/$db.db" 'PRAGMA quick_check; SELECT COUNT(*) FROM fixture;'
            done
            sha256sum "$stage/storages/state-fixture" "$stage/statics/media/media-fixture"
            restic check --read-data >/dev/null
        """,
            ],
            timeout=60,
        ).splitlines()
        assert checks[:4] == ["ok", "2", "ok", "2"]
        assert checks[4].split()[0] == hashlib.sha256(b"fixture state").hexdigest()
        assert checks[5].split()[0] == hashlib.sha256(b"fixture media").hexdigest()
        assert (storages / ".whatsapp-backup-last-success").read_text() == "0\n"

        # Storage can succeed before heartbeat delivery fails. That snapshot
        # alone must not be treated as an acknowledged successful job.
        failed = subprocess.run(
            backup("failure"), capture_output=True, text=True, timeout=90
        )
        assert failed.returncode != 0 and len(heartbeats) == 1
        assert (storages / ".whatsapp-backup-last-success").read_text() == "0\n"
        print(
            json.dumps(
                {
                    "restored_rows": [2, 2],
                    "WAL_rows_preserved": True,
                    "state_and_media_hashes_match": True,
                    "successful_heartbeats": 1,
                    "delivery_failure_exit": failed.returncode,
                }
            )
        )
        for writer in writers:
            writer.close()
finally:
    server.shutdown()
    clients = subprocess.run(
        [
            "docker",
            "ps",
            "-aq",
            "--filter",
            "label=codex.whatsapp-backup-test=" + test_id,
        ],
        capture_output=True,
        text=True,
        timeout=15,
    ).stdout.split()
    if clients:
        subprocess.run(
            ["docker", "rm", "-f"] + clients, capture_output=True, timeout=15
        )

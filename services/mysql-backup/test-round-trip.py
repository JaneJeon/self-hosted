import http.server
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import uuid

image = os.environ.get("BACKUP_TEST_IMAGE", "mysql-backup-test")
suffix = uuid.uuid4().hex[:8]
network = "codex-backup-" + suffix
database = "codex-mysql-" + suffix
fixture_password = uuid.uuid4().hex
env = dict(os.environ, MYSQL_ROOT_PASSWORD=fixture_password, MYSQL_PWD=fixture_password)
heartbeats = []


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/api/push/fixture?status=up":
            self.send_error(404)
            return
        heartbeats.append(time.time())
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'{"ok":true}')

    def log_message(self, *args):
        pass


def run(args, **kwargs):
    result = subprocess.run(args, env=env, capture_output=True, text=True, **kwargs)
    if result.returncode:
        raise RuntimeError(result.stderr[:2000])
    return result.stdout


server = http.server.ThreadingHTTPServer(("0.0.0.0", 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
network_created = False
database_created = False
try:
    run(["docker", "network", "create", network], timeout=15)
    network_created = True
    run(
        [
            "docker",
            "run",
            "--rm",
            "-d",
            "--name",
            database,
            "--network",
            network,
            "--network-alias",
            "mysql-fixture",
            "-e",
            "MYSQL_ROOT_PASSWORD",
            "-e",
            "MYSQL_ROOT_HOST=%",
            "mysql:8.4",
        ],
        timeout=30,
    )
    database_created = True
    for attempt in range(60):
        probe = subprocess.run(
            [
                "docker",
                "exec",
                "-e",
                "MYSQL_PWD",
                database,
                "mysql",
                "-u",
                "root",
                "--batch",
                "--skip-column-names",
                "-e",
                "SELECT 1;",
            ],
            env=env,
            capture_output=True,
            text=True,
            timeout=10,
        )
        if probe.returncode == 0:
            break
        time.sleep(1)
    else:
        raise RuntimeError("Fixture MySQL did not become ready")
    sql = "".join(
        f"CREATE DATABASE {name}; CREATE TABLE {name}.fixture (id INT PRIMARY KEY, value VARCHAR(32)); "
        f"INSERT INTO {name}.fixture VALUES (1,'round-trip'); "
        for name in ["ghost_devblog", "keycloak", "uptime_kuma"]
    )
    run(
        [
            "docker",
            "exec",
            "-e",
            "MYSQL_PWD",
            database,
            "mysql",
            "-u",
            "root",
            "-e",
            sql,
        ],
        timeout=15,
    )
    print("Fixture MySQL ready", flush=True)

    with tempfile.TemporaryDirectory(prefix="codex-backup-smoke-") as root:
        common = [
            "docker",
            "run",
            "--rm",
            "--user",
            f"{os.getuid()}:{os.getgid()}",
            "--network",
            network,
            "-v",
            root + ":/repo",
            "-e",
            "RESTIC_REPOSITORY=/repo",
            "-e",
            "RESTIC_PASSWORD=fixture",
            "-e",
            "RESTIC_CACHE_DIR=/tmp/restic-cache",
            "--label",
            "codex.mysql-backup-test=" + suffix,
        ]
        if sys.platform == "linux":
            common += ["--add-host", "host.docker.internal:host-gateway"]
        restic = common + ["--entrypoint", "restic", image]
        run(restic + ["init"], timeout=30)
        backup = common + [
            "-e",
            "MYSQL_HOST=mysql-fixture",
            "-e",
            "MYSQL_ROOT_PASSWORD",
            "-e",
            "B2_ACCOUNT_ID=fixture",
            "-e",
            "B2_ACCOUNT_KEY=fixture",
            "-e",
            f"HEARTBEAT_URL=http://host.docker.internal:{server.server_port}/api/push/fixture?status=up",
            image,
        ]
        output = run(backup, timeout=90)
        snapshots = json.loads(run(restic + ["snapshots", "--json"], timeout=30))
        assert len(snapshots) == 1 and len(heartbeats) == 1
        dump = run(restic + ["dump", "latest", "/all-databases.sql"], timeout=30)
        assert "-- Dump completed on" in dump
        run(
            [
                "docker",
                "exec",
                "-e",
                "MYSQL_PWD",
                database,
                "mysql",
                "-u",
                "root",
                "-e",
                "DROP DATABASE ghost_devblog; DROP DATABASE keycloak; DROP DATABASE uptime_kuma;",
            ],
            timeout=15,
        )
        run(
            [
                "docker",
                "exec",
                "-i",
                "-e",
                "MYSQL_PWD",
                database,
                "mysql",
                "-u",
                "root",
            ],
            input=dump,
            timeout=30,
        )
        counts = run(
            [
                "docker",
                "exec",
                "-e",
                "MYSQL_PWD",
                database,
                "mysql",
                "-u",
                "root",
                "--batch",
                "--skip-column-names",
                "-e",
                "SELECT COUNT(*) FROM ghost_devblog.fixture; SELECT COUNT(*) FROM keycloak.fixture; SELECT COUNT(*) FROM uptime_kuma.fixture;",
            ],
            timeout=15,
        ).splitlines()
        assert counts == ["1", "1", "1"]
        run(restic + ["check", "--read-data"], timeout=30)
        print(
            json.dumps(
                {
                    "image": image,
                    "snapshots": len(snapshots),
                    "heartbeat_requests": len(heartbeats),
                    "restored_fixture_row_counts": counts,
                }
            ),
            flush=True,
        )

        # A real restic backup must reject a command that fails after emitting
        # partial SQL. It must not save that stream or push success.
        failure = os.path.join(root, "failure-bin")
        os.mkdir(failure)
        with open(os.path.join(failure, "mysqldump"), "w") as f:
            f.write("#!/bin/sh\necho '-- partial fixture dump'\nexit 23\n")
        os.chmod(os.path.join(failure, "mysqldump"), 0o755)
        with open(os.path.join(failure, "sleep"), "w") as f:
            f.write("#!/bin/sh\nexit 0\n")
        os.chmod(os.path.join(failure, "sleep"), 0o755)
        failed = subprocess.run(
            backup[:-1]
            + [
                "--entrypoint",
                "bash",
                image,
                "-c",
                "export PATH=/repo/failure-bin:$PATH; exec /usr/local/bin/backup",
            ],
            env=env,
            capture_output=True,
            text=True,
            timeout=60,
        )
        after = json.loads(run(restic + ["snapshots", "--json"], timeout=30))
        assert failed.returncode != 0 and len(after) == 1 and len(heartbeats) == 1
        print(
            json.dumps(
                {
                    "partial_dump_exit": failed.returncode,
                    "snapshots_after_failure": len(after),
                    "heartbeats_after_failure": len(heartbeats),
                }
            ),
            flush=True,
        )
finally:
    server.shutdown()
    clients = subprocess.run(
        ["docker", "ps", "-aq", "--filter", "label=codex.mysql-backup-test=" + suffix],
        capture_output=True,
        text=True,
        timeout=15,
    ).stdout.split()
    if clients:
        subprocess.run(
            ["docker", "rm", "-f"] + clients, capture_output=True, timeout=15
        )
    if database_created:
        subprocess.run(
            ["docker", "rm", "-f", "-v", database], capture_output=True, timeout=15
        )
    if network_created:
        subprocess.run(
            ["docker", "network", "rm", network], capture_output=True, timeout=15
        )

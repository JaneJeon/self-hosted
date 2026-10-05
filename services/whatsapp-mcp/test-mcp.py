#!/usr/bin/env python3
"""Bounded real-Go WhatsApp MCP / pinned Agentgateway fixture regression.

All data is synthetic. Containers share an internal-only Docker network, so the
Go process cannot reach WhatsApp or any other external service.
"""

from __future__ import annotations

import json
import os
import pathlib
import shutil
import sqlite3
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

ROOT = pathlib.Path(tempfile.mkdtemp(prefix="wa-mcp-regression-"))
DATA = ROOT / "data"
GATEWAY_CONFIG = ROOT / "gateway.yaml"
REPORT = ROOT / "result.json"
IMAGE = os.environ.get("MCP_TEST_IMAGE", "codex-whatsapp-mcp:content-compat")
GATEWAY_IMAGE = "cr.agentgateway.dev/agentgateway:v1.5.0"
NETWORK = "wa-real-reg-20261005"
BACKEND = "wa-real-reg-backend"
HEARTBEAT = "wa-real-reg-heartbeat"
GATEWAY = "wa-real-reg-gateway"
DEVICE_ID = "fixture-only-device"
RESTIC_PASSWORD = "fixture-only-password-not-a-secret"


def run(args: list[str], *, check: bool = True, capture: bool = True) -> str:
    result = subprocess.run(
        args,
        check=check,
        text=True,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.STDOUT if capture else None,
    )
    return result.stdout or ""


def http_request(url: str, *, method="POST", payload=None, headers=None, timeout=10):
    request = urllib.request.Request(
        url,
        data=(
            json.dumps(payload, separators=(",", ":")).encode()
            if payload is not None
            else None
        ),
        method=method,
        headers=headers or {},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return (
                response.status,
                dict(response.headers.items()),
                response.read().decode("utf-8", "replace"),
            )
    except urllib.error.HTTPError as error:
        return (
            error.code,
            dict(error.headers.items()),
            error.read().decode("utf-8", "replace"),
        )


def mcp_request(_port: int, method: str, params=None, request_id=1) -> dict:
    # Run the HTTP client inside the internal Docker network. This keeps even
    # the test client away from public networking while exercising the gateway.
    code = r"""import http.client,json,sys,urllib.error,urllib.request
url,method,params_text,id_text=sys.argv[1:]
body={"jsonrpc":"2.0","method":method}
if id_text != "null": body["id"]=json.loads(id_text)
params=json.loads(params_text)
if params is not None: body["params"]=params
req=urllib.request.Request(url,data=json.dumps(body,separators=(",",":")).encode(),method="POST",headers={"Content-Type":"application/json","Accept":"application/json, text/event-stream","MCP-Protocol-Version":"2025-06-18"})
try:
 response=urllib.request.urlopen(req,timeout=15)
 status=response.status; headers=dict(response.headers.items()); raw=response.read().decode("utf-8","replace")
except urllib.error.HTTPError as error:
 status=error.code; headers=dict(error.headers.items()); raw=error.read().decode("utf-8","replace")
parsed=None
try: parsed=json.loads(raw) if raw else None
except json.JSONDecodeError:
 for line in raw.splitlines():
  if line.startswith("data:"):
   try: parsed=json.loads(line[5:].strip())
   except json.JSONDecodeError: pass
print(json.dumps({"http_status":status,"content_type":headers.get("Content-Type"),"session_id":headers.get("Mcp-Session-Id") or headers.get("mcp-session-id"),"result":parsed,"body":raw[:5000],"request":body}))
"""
    params_value = (
        json.dumps(params, separators=(",", ":")) if params is not None else "null"
    )
    id_value = json.dumps(request_id) if request_id is not None else "null"
    result = subprocess.run(
        [
            "docker",
            "exec",
            HEARTBEAT,
            "python3",
            "-c",
            code,
            "http://wa-real-reg-gateway:8080/whatsapp",
            method,
            params_value,
            id_value,
        ],
        check=False,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(
            f"MCP request client failed: {result.stdout[-2000:]}"
        ) from exc


def await_http(url: str, *, timeout=40, allowed_statuses=(200,)) -> None:
    until = time.monotonic() + timeout
    last = ""
    while time.monotonic() < until:
        try:
            status, _, body = http_request(url, method="GET", timeout=2)
            if status in allowed_statuses:
                return
            last = f"HTTP {status}: {body[:200]}"
        except Exception as exc:  # startup is asynchronous
            last = repr(exc)
        time.sleep(0.25)
    raise RuntimeError(f"endpoint did not become ready: {url}; last={last}")


def started_at(name: str) -> str:
    return run(["docker", "inspect", name, "--format", "{{.State.StartedAt}}"]).strip()


def cleanup() -> None:
    for name in (GATEWAY, BACKEND, HEARTBEAT, "wa-real-reg-seed"):
        run(["docker", "rm", "-f", name], check=False)
    run(["docker", "network", "rm", NETWORK], check=False)
    shutil.rmtree(DATA, ignore_errors=True)
    GATEWAY_CONFIG.unlink(missing_ok=True)


def create_empty_fixture_databases() -> None:
    (DATA / "storages").mkdir(parents=True)
    (DATA / "statics" / "qrcode").mkdir(parents=True)
    (DATA / "statics" / "senditems").mkdir(parents=True)
    (DATA / "statics" / "media").mkdir(parents=True)
    # Create valid but empty SQLite files. GOWA applies its own migrations.
    for name in ("whatsapp.db", "chatstorage.db"):
        path = DATA / "storages" / name
        with sqlite3.connect(path) as db:
            db.execute("CREATE TABLE fixture_seed (id INTEGER PRIMARY KEY)")
            db.execute("DROP TABLE fixture_seed")
            assert db.execute("PRAGMA quick_check").fetchone() == ("ok",)
    (DATA / ".migration-ready").touch()


def create_device_placeholder() -> None:
    run(
        [
            "docker",
            "run",
            "-d",
            "--name",
            "wa-real-reg-seed",
            "--network",
            NETWORK,
            "--volume",
            f"{DATA}:/app/data",
            "--env",
            "APP_UI_ENABLED=false",
            "--env",
            "APP_UI_AUTO_UPDATE=false",
            "--entrypoint",
            "/app/whatsapp",
            IMAGE,
            "rest",
            "--host",
            "0.0.0.0",
            "--port",
            "8080",
        ]
    )
    ready = False
    for _ in range(120):
        probe = subprocess.run(
            [
                "docker",
                "exec",
                "wa-real-reg-seed",
                "curl",
                "-sS",
                "-o",
                "/dev/null",
                "-w",
                "%{http_code}",
                "http://127.0.0.1:8080/health",
            ],
            check=False,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )
        if probe.returncode == 0 and probe.stdout == "200":
            ready = True
            break
        time.sleep(0.25)
    if not ready:
        raise RuntimeError("synthetic REST seeder did not become ready")
    response = subprocess.run(
        [
            "docker",
            "exec",
            "wa-real-reg-seed",
            "curl",
            "-fsS",
            "-H",
            "Content-Type: application/json",
            "-d",
            json.dumps({"device_id": DEVICE_ID}),
            "http://127.0.0.1:8080/devices",
        ],
        check=False,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    if response.returncode != 0:
        raise RuntimeError(
            f"failed to create synthetic unpaired device: {response.stdout}"
        )
    parsed = json.loads(response.stdout)
    if DEVICE_ID not in json.dumps(parsed):
        raise RuntimeError(f"synthetic device missing from response: {response.stdout}")
    run(["docker", "rm", "-f", "wa-real-reg-seed"])


def check_structured_status(result: dict, label: str) -> dict:
    if result["http_status"] != 200:
        raise RuntimeError(f"{label} failed: {result}")
    rpc = result["result"] or {}
    tool = rpc.get("result") or {}
    structured = tool.get("structuredContent")
    content = tool.get("content") or []
    if not isinstance(structured, dict):
        raise RuntimeError(f"{label} omitted structuredContent: {result}")
    if not {"is_connected", "is_logged_in", "device_id"}.issubset(structured):
        raise RuntimeError(f"{label} structured fields wrong: {structured}")
    if (
        structured["device_id"] != DEVICE_ID
        or structured["is_connected"] is not False
        or structured["is_logged_in"] is not False
    ):
        raise RuntimeError(f"{label} has unexpected fixture status: {structured}")
    text_blocks = [
        item.get("text", "") for item in content if item.get("type") == "text"
    ]
    if len(text_blocks) < 2:
        raise RuntimeError(
            f"{label} did not append structured JSON as a text block: {tool}"
        )
    try:
        visible = json.loads(text_blocks[-1])
    except json.JSONDecodeError as exc:
        raise RuntimeError(
            f"{label} appended text was not JSON: {text_blocks[-1]!r}"
        ) from exc
    if visible != structured:
        raise RuntimeError(
            f"{label} JSON text differs from structuredContent: {visible} != {structured}"
        )
    return {
        "structured_content": structured,
        "text_json": visible,
        "content_block_count": len(content),
    }


def main() -> None:
    for name in (GATEWAY, BACKEND, HEARTBEAT, "wa-real-reg-seed"):
        if (
            subprocess.run(["docker", "inspect", name], capture_output=True).returncode
            == 0
        ):
            raise RuntimeError(f"refusing to touch pre-existing container {name}")
    if (
        subprocess.run(
            ["docker", "network", "inspect", NETWORK], capture_output=True
        ).returncode
        == 0
    ):
        raise RuntimeError(f"refusing to touch pre-existing network {NETWORK}")
    if DATA.exists():
        raise RuntimeError(f"refusing to overwrite existing fixture data at {DATA}")
    DATA.mkdir(parents=True)
    create_empty_fixture_databases()
    run(["docker", "network", "create", "--internal", NETWORK])
    create_device_placeholder()

    heartbeat_code = """from http.server import BaseHTTPRequestHandler, HTTPServer
class H(BaseHTTPRequestHandler):
 def do_GET(self):
  print(self.path, flush=True)
  self.send_response(200)
  self.end_headers()
  self.wfile.write(b'ok')
 def log_message(self, *args):
  pass
HTTPServer(('0.0.0.0', 9911), H).serve_forever()
"""
    run(
        [
            "docker",
            "run",
            "-d",
            "--name",
            HEARTBEAT,
            "--network",
            NETWORK,
            "--network-alias",
            "wa-real-reg-heartbeat",
            "--volume",
            f"{ROOT}:/fixture:ro",
            "python:3.13-alpine",
            "python3",
            "-u",
            "-c",
            heartbeat_code,
        ]
    )

    run(
        [
            "docker",
            "run",
            "--rm",
            "--network",
            NETWORK,
            "--volume",
            f"{DATA}:/app/data",
            "--env",
            "RESTIC_REPOSITORY=local:/app/data/fixture-repository",
            "--env",
            f"RESTIC_PASSWORD={RESTIC_PASSWORD}",
            "--entrypoint",
            "/usr/local/bin/restic",
            IMAGE,
            "init",
        ]
    )

    run(
        [
            "docker",
            "run",
            "-d",
            "--name",
            BACKEND,
            "--network",
            NETWORK,
            "--network-alias",
            BACKEND,
            "--volume",
            f"{DATA}:/app/data",
            "--env",
            "WHATSAPP_MCP_HOST=wa-real-reg-backend",
            "--env",
            "RESTIC_REPOSITORY=local:/app/data/fixture-repository",
            "--env",
            f"RESTIC_PASSWORD={RESTIC_PASSWORD}",
            "--env",
            "B2_ACCOUNT_ID=fixture-only-account",
            "--env",
            "B2_ACCOUNT_KEY=fixture-only-key",
            "--env",
            "HEARTBEAT_URL=http://wa-real-reg-heartbeat:9911/ok",
            IMAGE,
        ]
    )

    GATEWAY_CONFIG.write_text(
        "config:\n"
        "  adminAddr: 127.0.0.1:15000\n"
        "gateways:\n"
        "  default:\n"
        "    port: 8080\n"
        "routes:\n"
        "  - name: whatsapp-fixture\n"
        "    matches:\n"
        "      - path:\n"
        "          exact: /whatsapp\n"
        "    backends:\n"
        "      - mcp:\n"
        "          statefulMode: stateless\n"
        "          targets:\n"
        "            - name: whatsapp-fixture\n"
        "              sse:\n"
        "                host: wa-real-reg-backend\n"
        "                port: 8080\n"
        "                path: /sse\n",
        encoding="utf-8",
    )
    run(
        [
            "docker",
            "run",
            "-d",
            "--name",
            GATEWAY,
            "--network",
            NETWORK,
            "--network-alias",
            "wa-real-reg-gateway",
            "--volume",
            f"{GATEWAY_CONFIG}:/config.yaml:ro",
            GATEWAY_IMAGE,
            "-f",
            "/config.yaml",
        ]
    )

    # Confirm the route listener from the internal client container.
    ready = False
    for _ in range(120):
        probe_code = "import urllib.request,urllib.error,sys;\ntry: urllib.request.urlopen(sys.argv[1],timeout=2)\nexcept urllib.error.HTTPError as e: print(e.code)\nexcept Exception as e: print(type(e).__name__)"
        probe = subprocess.run(
            [
                "docker",
                "exec",
                HEARTBEAT,
                "python3",
                "-c",
                probe_code,
                "http://wa-real-reg-gateway:8080/whatsapp",
            ],
            check=False,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )
        if probe.returncode == 0 and probe.stdout.strip() in {
            "400",
            "404",
            "405",
            "406",
            "500",
            "501",
        }:
            ready = True
            break
        time.sleep(0.25)
    if not ready:
        raise RuntimeError("gateway route listener did not become ready")
    gateway_start = started_at(GATEWAY)
    initialize = mcp_request(
        0,
        "initialize",
        {
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": {"name": "real-gowa-fixture-client", "version": "1"},
        },
        10,
    )
    if initialize["http_status"] != 200 or initialize["session_id"]:
        raise RuntimeError(f"stateless initialize unexpected: {initialize}")
    initialized = mcp_request(0, "notifications/initialized", None, None)
    tools_before = mcp_request(0, "tools/list", {}, 11)
    if tools_before["http_status"] != 200:
        raise RuntimeError(f"tools/list failed: {tools_before}")
    tool_list = (tools_before["result"] or {}).get("result", {}).get("tools", [])
    if len(tool_list) != 40:
        raise RuntimeError(f"expected 40 tools, got {len(tool_list)}")
    if tools_before["session_id"]:
        raise RuntimeError(
            f"stateless tools/list returned a downstream session: {tools_before['session_id']}"
        )
    status_before = mcp_request(
        0,
        "tools/call",
        {
            "name": "whatsapp_connection_status",
            "arguments": {},
        },
        12,
    )
    before_content = check_structured_status(
        status_before, "pre-restart connection_status"
    )

    # Allow startup's first synthetic local-restic backup to finish and post only
    # to the fake endpoint; this also exercises fake B2 variables without using B2.
    heartbeat_seen = False
    until = time.monotonic() + 50
    while time.monotonic() < until:
        logs = run(["docker", "logs", HEARTBEAT], check=False)
        if "/ok" in logs:
            heartbeat_seen = True
            break
        time.sleep(0.5)
    if not heartbeat_seen:
        raise RuntimeError(
            "fake heartbeat endpoint did not receive a backup success request"
        )

    run(["docker", "restart", BACKEND])
    # Same URL, same protocol and request bodies, and no session header after restart.
    tools_after = None
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        try:
            probe = mcp_request(0, "tools/list", {}, 13)
            if probe["http_status"] == 200:
                tools_after = probe
                break
        except Exception:
            pass
        time.sleep(0.5)
    if tools_after is None:
        raise RuntimeError(
            "same gateway failed to list tools after fixture backend restart"
        )
    status_after = mcp_request(
        0,
        "tools/call",
        {
            "name": "whatsapp_connection_status",
            "arguments": {},
        },
        14,
    )
    after_content = check_structured_status(
        status_after, "post-restart connection_status"
    )
    if tools_after["http_status"] != 200:
        raise RuntimeError(f"post-restart tools/list failed: {tools_after}")
    tools_after_names = [
        tool.get("name")
        for tool in (tools_after["result"] or {}).get("result", {}).get("tools", [])
    ]
    if len(tools_after_names) != 40 or tools_after_names != [
        tool.get("name") for tool in tool_list
    ]:
        raise RuntimeError("post-restart tool list changed")
    if tools_after["session_id"] or status_after["session_id"]:
        raise RuntimeError(
            "stateless client calls unexpectedly returned a downstream session ID"
        )
    gateway_after = started_at(GATEWAY)
    if gateway_start != gateway_after:
        raise RuntimeError(f"gateway restarted: {gateway_start} -> {gateway_after}")

    result = {
        "candidate_image": IMAGE,
        "candidate_image_id": run(
            ["docker", "image", "inspect", IMAGE, "--format", "{{.Id}}"]
        ).strip(),
        "gateway_image": GATEWAY_IMAGE,
        "network": NETWORK,
        "network_internal": True,
        "gateway_client": "Python client exec'd inside the isolated fixture network",
        "fixture_device_id": DEVICE_ID,
        "fixture_databases": ["empty whatsapp.db", "empty chatstorage.db"],
        "external_whatsapp_route": "blocked by internal Docker network",
        "route_stateful_mode": "stateless",
        "initialize_http_status": initialize["http_status"],
        "initialize_session_id": initialize["session_id"],
        "initialized_notification_status": initialized["http_status"],
        "tools_before_count": len(tool_list),
        "status_before": before_content,
        "tools_after_count": len(tools_after_names),
        "status_after": after_content,
        "downstream_session_ids_returned": [
            initialize["session_id"],
            tools_before["session_id"],
            status_before["session_id"],
            tools_after["session_id"],
            status_after["session_id"],
        ],
        "gateway_started_at_before": gateway_start,
        "gateway_started_at_after": gateway_after,
        "gateway_lifetime_unchanged": gateway_start == gateway_after,
        "backend_restarted_only": BACKEND,
        "fake_restic_repository_initialized": True,
        "fake_success_heartbeat_received": heartbeat_seen,
        "limits": "Stateless transport behavior inferred from route mode, absent downstream session IDs, and successful same-client calls after backend restart; no WhatsApp login/session or user data was present.",
    }
    REPORT.write_text(
        json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("Integration failed; collecting fixture logs before cleanup.")
        for name in (GATEWAY, BACKEND, HEARTBEAT, "wa-real-reg-seed"):
            print(f"--- {name} ---")
            print(run(["docker", "logs", name], check=False)[-10000:])
        raise
    finally:
        cleanup()

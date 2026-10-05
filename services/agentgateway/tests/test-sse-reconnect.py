#!/usr/bin/env python3
"""Run the pinned v1.5.0 legacy-SSE restart regression in Docker."""

from __future__ import annotations

import http.client
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

CODE_ROOT = pathlib.Path(__file__).resolve().parent
ROOT = pathlib.Path(tempfile.mkdtemp(prefix="mcp-sse-regression-"))
IMAGE = "cr.agentgateway.dev/agentgateway:v1.5.0"
IMAGE_DIGEST = "sha256:bf2f339ef326d32def2aaeb44b1b4549801293c19b89e764a4228667d97d9896"
BACKEND_PORT = 18080
GATEWAY_PORTS = {"stateful": 18100, "stateless": 18101}


def fetch(url: str, *, method="GET", body=None, headers=None, timeout=5):
    request = urllib.request.Request(
        url, data=body, method=method, headers=headers or {}
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, dict(response.headers.items()), response.read()
    except urllib.error.HTTPError as error:
        return error.code, dict(error.headers.items()), error.read()


def mcp_call(
    port: int,
    method: str,
    params: dict | None,
    request_id,
    session_id: str | None,
    protocol="2025-06-18",
) -> dict:
    body_obj = {"jsonrpc": "2.0", "method": method}
    if request_id is not None:
        body_obj["id"] = request_id
    if params is not None:
        body_obj["params"] = params
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "MCP-Protocol-Version": protocol,
    }
    if session_id:
        headers["Mcp-Session-Id"] = session_id
    status, response_headers, raw = fetch(
        f"http://127.0.0.1:{port}/mcp",
        method="POST",
        body=json.dumps(body_obj, separators=(",", ":")).encode(),
        headers=headers,
        timeout=8,
    )
    text = raw.decode("utf-8", "replace")
    parsed = None
    try:
        parsed = json.loads(text) if text else None
    except json.JSONDecodeError:
        for line in text.splitlines():
            if line.startswith("data:"):
                try:
                    parsed = json.loads(line[5:].strip())
                except json.JSONDecodeError:
                    pass
    return {
        "http_status": status,
        "content_type": response_headers.get("Content-Type"),
        "session_id": response_headers.get("Mcp-Session-Id")
        or response_headers.get("mcp-session-id"),
        "result": parsed,
        "body": text[:1000],
        "request": body_obj,
    }


def start_gateway(name: str, port: int, mode: str) -> tuple[str, str]:
    config = ROOT / f"{name}.yaml"
    stateful_line = (
        "" if mode == "default-stateful" else f"          statefulMode: {mode}\n"
    )
    config.write_text(
        "config:\n"
        "  adminAddr: 127.0.0.1:15000\n"
        "gateways:\n"
        "  default:\n"
        "    port: 8080\n"
        "routes:\n"
        "  - name: mcp-fixture\n"
        "    matches:\n"
        "      - path:\n"
        "          exact: /mcp\n"
        "    backends:\n"
        "      - mcp:\n"
        f"{stateful_line}"
        "          targets:\n"
        "            - name: fixture\n"
        "              sse:\n"
        "                host: host.docker.internal\n"
        f"                port: {BACKEND_PORT}\n"
        "                path: /sse\n",
        encoding="utf-8",
    )
    subprocess.run(
        ["docker", "rm", "-f", name],
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    subprocess.run(
        [
            "docker",
            "run",
            "-d",
            "--add-host",
            "host.docker.internal:host-gateway",
            "--name",
            name,
            "-p",
            f"127.0.0.1:{port}:8080",
            "-v",
            f"{config}:/config.yaml:ro",
            IMAGE,
            "-f",
            "/config.yaml",
        ],
        check=True,
        stdout=subprocess.DEVNULL,
    )
    for _ in range(80):
        try:
            status, _, _ = fetch(f"http://127.0.0.1:{port}/mcp", timeout=1)
            if status in (400, 404, 405, 406, 500, 501):
                break
        except Exception:
            pass
        time.sleep(0.25)
    else:
        raise RuntimeError(f"gateway {name} did not start; logs: {docker_logs(name)}")
    started_at = docker_inspect(name, "{{.State.StartedAt}}")
    return config.read_text(encoding="utf-8"), started_at


def docker_inspect(name: str, template: str) -> str:
    return subprocess.check_output(
        ["docker", "inspect", name, "--format", template], text=True
    ).strip()


def docker_logs(name: str) -> str:
    return subprocess.run(
        ["docker", "logs", name], text=True, capture_output=True
    ).stdout[-5000:]


def direct_sse_probe() -> dict:
    conn = http.client.HTTPConnection("127.0.0.1", BACKEND_PORT, timeout=4)
    conn.request("GET", "/sse", headers={"Accept": "text/event-stream"})
    response = conn.getresponse()
    first = response.readline().decode("utf-8", "replace").strip()
    second = response.readline().decode("utf-8", "replace").strip()
    conn.close()
    return {
        "http_status": response.status,
        "content_type": response.getheader("Content-Type"),
        "event_line": first,
        "data_line": second,
        "healthy": response.status == 200 and second.startswith("data: /message?"),
    }


def wait_no_active_backend_sse() -> None:
    for _ in range(80):
        status, _, raw = fetch(f"http://127.0.0.1:{BACKEND_PORT}/admin/state")
        state = json.loads(raw) if status == 200 else {}
        if not state.get("active") and len(state.get("ended", [])) == len(
            state.get("backend_sessions", [])
        ):
            return
        time.sleep(0.05)
    raise RuntimeError("mock backend still reports active SSE streams")


def stateful_run() -> dict:
    port = GATEWAY_PORTS["stateful"]
    _, started_at = start_gateway("agw-sse-stateful", port, "default-stateful")
    before_init = mcp_call(
        port,
        "initialize",
        {
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": {"name": "regression-client", "version": "1"},
        },
        1,
        None,
    )
    downstream_id = before_init["session_id"]
    if before_init["http_status"] != 200 or not downstream_id:
        raise RuntimeError(
            f"stateful initialize failed: {before_init}; logs={docker_logs('agw-sse-stateful')}"
        )

    initialized = mcp_call(port, "notifications/initialized", None, None, downstream_id)
    before_restart = mcp_call(
        port, "tools/call", {"name": "status", "arguments": {}}, 2, downstream_id
    )
    if before_restart["http_status"] != 200 or "status:ok" not in json.dumps(
        before_restart["result"]
    ):
        raise RuntimeError(f"stateful pre-restart tool call failed: {before_restart}")

    status, _, close_raw = fetch(f"http://127.0.0.1:{BACKEND_PORT}/admin/close-sse")
    wait_no_active_backend_sse()
    backend_probe = direct_sse_probe()
    same_session_after_restart = mcp_call(
        port, "tools/call", {"name": "status", "arguments": {}}, 3, downstream_id
    )
    started_after = docker_inspect("agw-sse-stateful", "{{.State.StartedAt}}")
    if (
        same_session_after_restart["http_status"] != 500
        or "upstream closed on receive" not in same_session_after_restart["body"]
    ):
        raise RuntimeError(
            f"same-session request did not reproduce the stale SSE transport: {same_session_after_restart}"
        )
    if not backend_probe["healthy"] or started_at != started_after:
        raise RuntimeError(
            f"control conditions failed: backend_probe={backend_probe}, gateway_started={started_at}/{started_after}"
        )

    fresh_init = mcp_call(
        port,
        "initialize",
        {
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": {"name": "fresh-regression-client", "version": "1"},
        },
        11,
        None,
    )
    fresh_id = fresh_init["session_id"]
    fresh_initialized = mcp_call(
        port, "notifications/initialized", None, None, fresh_id
    )
    fresh_call = mcp_call(
        port, "tools/call", {"name": "status", "arguments": {}}, 12, fresh_id
    )
    if (
        fresh_init["http_status"] != 200
        or fresh_call["http_status"] != 200
        or "status:ok" not in json.dumps(fresh_call["result"])
    ):
        raise RuntimeError(
            f"fresh downstream session did not recover: init={fresh_init}, call={fresh_call}"
        )
    return {
        "mode": "default-stateful",
        "gateway_started_at_before": started_at,
        "gateway_started_at_after": started_after,
        "gateway_lifetime_unchanged": started_at == started_after,
        "downstream_session_id_preserved": downstream_id,
        "sequence": [
            {"step": "initialize", **before_init},
            {"step": "notifications/initialized", **initialized},
            {"step": "status_before_backend_restart", **before_restart},
            {
                "step": "backend_close_existing_sse",
                "http_status": status,
                "closed_backend_session_ids": json.loads(close_raw).get("closed", []),
            },
            {"step": "fresh_private_backend_sse_probe", **backend_probe},
            {
                "step": "status_same_downstream_session_after_backend_restart",
                **same_session_after_restart,
            },
            {"step": "fresh_initialize", **fresh_init},
            {"step": "fresh_notifications_initialized", **fresh_initialized},
            {"step": "status_fresh_downstream_session", **fresh_call},
        ],
    }


def stateless_run() -> dict:
    port = GATEWAY_PORTS["stateless"]
    config, started_at = start_gateway("agw-sse-stateless", port, "stateless")
    before_init = mcp_call(
        port,
        "initialize",
        {
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": {"name": "stateless-regression-client", "version": "1"},
        },
        21,
        None,
    )
    downstream_id = before_init["session_id"]
    initialized = mcp_call(port, "notifications/initialized", None, None, downstream_id)
    before_restart = mcp_call(
        port, "tools/call", {"name": "status", "arguments": {}}, 22, downstream_id
    )

    status, _, close_raw = fetch(f"http://127.0.0.1:{BACKEND_PORT}/admin/close-sse")
    wait_no_active_backend_sse()
    backend_probe = direct_sse_probe()
    after_restart = mcp_call(
        port, "tools/call", {"name": "status", "arguments": {}}, 23, downstream_id
    )
    started_after = docker_inspect("agw-sse-stateless", "{{.State.StartedAt}}")
    if after_restart["http_status"] != 200 or "status:ok" not in json.dumps(
        after_restart["result"]
    ):
        raise RuntimeError(
            f"stateless request did not use a fresh healthy SSE transport: {after_restart}"
        )
    if (
        downstream_id is not None
        or started_at != started_after
        or not backend_probe["healthy"]
    ):
        raise RuntimeError(
            f"stateless controls failed: session_id={downstream_id}, backend_probe={backend_probe}, gateway_started={started_at}/{started_after}"
        )
    return {
        "mode": "stateless",
        "configured_property": "backends[].mcp.statefulMode",
        "configured_value": "stateless",
        "configuration_excerpt": [
            line for line in config.splitlines() if "statefulMode" in line
        ],
        "gateway_started_at_before": started_at,
        "gateway_started_at_after": started_after,
        "gateway_lifetime_unchanged": started_at == started_after,
        "downstream_session_id_returned": downstream_id,
        "sequence": [
            {"step": "initialize", **before_init},
            {"step": "notifications/initialized", **initialized},
            {"step": "status_before_backend_restart", **before_restart},
            {
                "step": "backend_close_existing_sse",
                "http_status": status,
                "closed_backend_session_ids": json.loads(close_raw).get("closed", []),
            },
            {"step": "fresh_private_backend_sse_probe", **backend_probe},
            {"step": "status_after_backend_restart", **after_restart},
        ],
    }


def main() -> int:
    image_id = subprocess.check_output(
        ["docker", "image", "inspect", IMAGE, "--format", "{{.Id}}"], text=True
    ).strip()
    digests = json.loads(docker_inspect(IMAGE, "{{json .RepoDigests}}"))
    if not any(digest.endswith("@" + IMAGE_DIGEST) for digest in digests):
        raise RuntimeError("unexpected gateway manifest digest")

    subprocess.run(
        ["docker", "rm", "-f", "agw-sse-stateful", "agw-sse-stateless"],
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    events_file = pathlib.Path("/tmp/mock-events.jsonl")
    events_file.unlink(missing_ok=True)
    mock = subprocess.Popen(
        [sys.executable, str(CODE_ROOT / "mock_sse.py")],
        cwd=ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    results = {
        "gateway_image": IMAGE,
        "gateway_image_id": image_id,
        "gateway_digest": IMAGE_DIGEST,
    }
    try:
        for _ in range(80):
            try:
                status, _, _ = fetch(
                    f"http://127.0.0.1:{BACKEND_PORT}/health", timeout=0.5
                )
                if status == 200:
                    break
            except Exception:
                pass
            time.sleep(0.1)
        else:
            raise RuntimeError("mock backend did not start")
        results["stateful"] = stateful_run()
        results["stateless"] = stateless_run()
    finally:
        mock.terminate()
        try:
            mock.wait(timeout=3)
        except subprocess.TimeoutExpired:
            mock.kill()
        subprocess.run(
            ["docker", "rm", "-f", "agw-sse-stateful", "agw-sse-stateless"],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    results["mock_backend_events"] = (
        [json.loads(line) for line in events_file.read_text().splitlines()]
        if events_file.exists()
        else []
    )
    print(json.dumps(results, indent=2, sort_keys=True))
    (ROOT / "result.json").write_text(
        json.dumps(results, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({"error": str(exc)}, indent=2), file=sys.stderr)
        raise

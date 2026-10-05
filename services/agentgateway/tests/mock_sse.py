#!/usr/bin/env python3
"""Minimal MCP legacy-SSE backend with a controllable SSE EOF."""

from __future__ import annotations

import json
import queue
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

lock = threading.Lock()
sessions: dict[str, dict] = {}
events: list[dict] = []


def record(kind: str, **fields) -> None:
    row = {"at": time.time(), "kind": kind, **fields}
    with lock:
        events.append(row)
        with open("/tmp/mock-events.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps(row, separators=(",", ":")) + "\n")


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_args) -> None:
        pass

    def send_json(self, status: int, value: dict) -> None:
        payload = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            self.send_json(200, {"ok": True})
            return
        if parsed.path == "/admin/close-sse":
            with lock:
                active = [sid for sid, row in sessions.items() if row["active"]]
                for sid in active:
                    sessions[sid]["queue"].put(None)
                    sessions[sid]["active"] = False
            record("admin_close_sse", backend_session_ids=active)
            self.send_json(200, {"closed": active})
            return
        if parsed.path == "/admin/state":
            with lock:
                active = [sid for sid, row in sessions.items() if row["active"]]
                all_ids = list(sessions)
                ended = [sid for sid, row in sessions.items() if row.get("ended")]
            self.send_json(
                200, {"active": active, "backend_sessions": all_ids, "ended": ended}
            )
            return
        if parsed.path != "/sse":
            self.send_json(404, {"error": "not found"})
            return

        sid = str(uuid.uuid4())
        q: queue.Queue = queue.Queue()
        with lock:
            sessions[sid] = {"queue": q, "active": True, "ended": False}
        record("sse_open", backend_session_id=sid)
        endpoint = f"/message?sessionId={sid}"
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        try:
            self.wfile.write(f"event: endpoint\ndata: {endpoint}\n\n".encode())
            self.wfile.flush()
            while True:
                try:
                    message = q.get(timeout=0.5)
                except queue.Empty:
                    continue
                if message is None:
                    break
                data = json.dumps(message, separators=(",", ":"))
                self.wfile.write(f"event: message\ndata: {data}\n\n".encode())
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            with lock:
                if sid in sessions:
                    sessions[sid]["active"] = False
                    sessions[sid]["ended"] = True
            record("sse_eof", backend_session_id=sid)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path != "/message":
            self.send_json(404, {"error": "not found"})
            return
        sid = parse_qs(parsed.query).get("sessionId", [""])[0]
        body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        try:
            request = json.loads(body)
        except Exception:
            self.send_json(400, {"error": "invalid json"})
            return
        record("post", backend_session_id=sid, request=request)
        with lock:
            state = sessions.get(sid)
        if not state:
            self.send_json(404, {"error": "unknown session"})
            return

        if request.get("id") is not None:
            method = request.get("method")
            if method == "initialize":
                result = {
                    "protocolVersion": request.get("params", {}).get(
                        "protocolVersion", "2025-06-18"
                    ),
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "restart-fixture", "version": "1"},
                }
            elif method == "tools/list":
                result = {
                    "tools": [
                        {
                            "name": "status",
                            "description": "Read fixture status",
                            "inputSchema": {"type": "object", "properties": {}},
                        }
                    ]
                }
            elif method == "tools/call":
                result = {
                    "content": [{"type": "text", "text": "status:ok"}],
                    "isError": False,
                }
            else:
                result = {"tools": []} if method == "prompts/list" else {}
            response = {"jsonrpc": "2.0", "id": request["id"], "result": result}
            if state["active"]:
                state["queue"].put(response)

        self.send_response(202)
        self.send_header("Content-Length", "0")
        self.end_headers()


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 18080), Handler).serve_forever()

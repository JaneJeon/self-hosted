"""Nine immutable database queries. No paired-device, media or network tools."""

import functools
import hashlib
import json
import os
import pathlib
import socket
import sqlite3

import uvicorn
import whatsapp
from main import mcp
from mcp.types import ToolAnnotations
from starlette.responses import JSONResponse

DATA = pathlib.Path("/app/data")
ALLOWED = frozenset(
    {
        "search_contacts",
        "get_contact",
        "list_messages",
        "list_chats",
        "get_chat",
        "get_direct_chat_by_contact",
        "get_contact_chats",
        "get_last_interaction",
        "get_message_context",
    }
)
if os.environ.get("WHATSAPP_CANDIDATE_READ_ONLY") != "1":
    raise RuntimeError("WhatsApp trial requires read-only mode")
manifest = json.loads((DATA / "snapshot.json").read_text())
if manifest["snapshot"] != os.environ["WHATSAPP_TRIAL_SNAPSHOT"]:
    raise RuntimeError("WhatsApp trial snapshot identity mismatch")
fingerprints = {}
for name in ("messages.db", "contacts.db"):
    path = DATA / name
    if hashlib.sha256(path.read_bytes()).hexdigest() != manifest["sha256"][name]:
        raise RuntimeError("WhatsApp trial snapshot checksum mismatch")
    with sqlite3.connect(path.as_uri() + "?mode=ro&immutable=1", uri=True) as db:
        if db.execute("PRAGMA quick_check").fetchone() != ("ok",):
            raise RuntimeError("WhatsApp trial database failed quick_check")
        expected = (
            {"chats", "messages"}
            if name == "messages.db"
            else {"whatsmeow_contacts", "whatsmeow_lid_map"}
        )
        if {
            row[0]
            for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")
        } != expected:
            raise RuntimeError("WhatsApp trial contains unexpected database tables")
        columns = {
            "chats": {"jid", "name", "last_message_time", "last_read_time"},
            "messages": {
                "id",
                "chat_jid",
                "sender",
                "content",
                "timestamp",
                "is_from_me",
                "media_type",
                "filename",
                "quoted_message_id",
            },
            "whatsmeow_contacts": {
                "their_jid",
                "full_name",
                "push_name",
                "first_name",
                "business_name",
            },
            "whatsmeow_lid_map": {"lid", "pn"},
        }
        counts = {
            "chats": "chats",
            "messages": "messages",
            "whatsmeow_contacts": "contacts",
            "whatsmeow_lid_map": "lid_mappings",
        }
        for table in expected:
            if {row[1] for row in db.execute(f"PRAGMA table_info({table})")} != columns[
                table
            ]:
                raise RuntimeError("WhatsApp trial query schema mismatch")
            if (
                db.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
                != manifest[counts[table]]
            ):
                raise RuntimeError("WhatsApp trial row count mismatch")
        if db.execute("PRAGMA foreign_key_check").fetchall():
            raise RuntimeError("WhatsApp trial foreign key mismatch")
    state = path.stat()
    fingerprints[name] = (state.st_ino, state.st_size, state.st_mtime_ns)
for name in ("snapshot.json", ".snapshot-ready"):
    state = (DATA / name).stat()
    fingerprints[name] = (state.st_ino, state.st_size, state.st_mtime_ns)


def require_snapshot():
    for name, original in fingerprints.items():
        try:
            state = (DATA / name).stat()
        except OSError:
            raise RuntimeError("WhatsApp trial snapshot unavailable") from None
        if (state.st_ino, state.st_size, state.st_mtime_ns) != original:
            raise RuntimeError(
                "WhatsApp trial snapshot changed; restart with reviewed data"
            )


# Upstream query functions use sqlite3.connect(path). Force their connections
# read-only, immutable and confined to the two reviewed snapshot files.
connect = sqlite3.connect
paths = {str(DATA / name) for name in ("messages.db", "contacts.db")}


def readonly_connect(path, *args, **kwargs):
    require_snapshot()
    if str(path) not in paths or args or kwargs:
        raise RuntimeError("WhatsApp trial rejected an unexpected database connection")
    return connect(pathlib.Path(path).as_uri() + "?mode=ro&immutable=1", uri=True)


sqlite3.connect = readonly_connect


def no_network(*_args, **_kwargs):
    raise RuntimeError("Network operations are disabled in the WhatsApp snapshot trial")


whatsapp.requests.sessions.Session.request = no_network
tools = mcp._tool_manager.list_tools()
if not ALLOWED.issubset({tool.name for tool in tools}):
    raise RuntimeError("Pinned upstream query inventory changed")
for tool in tools:
    mcp.remove_tool(tool.name)
    if tool.name not in ALLOWED:
        continue

    def guarded(function):
        @functools.wraps(function)
        def call(*args, **kwargs):
            require_snapshot()
            return function(*args, **kwargs)

        return call

    mcp.add_tool(
        guarded(tool.fn),
        name=tool.name,
        description=(
            "IMMUTABLE SNAPSHOT TRIAL: stored history from "
            + manifest["time"]
            + "; not a live WhatsApp connection. Imported read state is unknown.\n"
            + tool.description
        ),
        annotations=ToolAnnotations(
            readOnlyHint=True,
            destructiveHint=False,
            idempotentHint=True,
            openWorldHint=False,
        ),
    )
mcp._mcp_server.name = "whatsapp-snapshot-trial"
mcp._mcp_server.instructions = (
    "This is immutable WhatsApp history from snapshot "
    + manifest["snapshot"]
    + " at "
    + manifest["time"]
    + ". It is not live. "
    + "Do not claim current connection status, freshness beyond that timestamp, or unread status."
)


@mcp.custom_route("/health", methods=["GET"])
async def health(_request):
    try:
        require_snapshot()
    except RuntimeError:
        return JSONResponse({"ready": False, "snapshot_based": True}, status_code=503)
    return JSONResponse(
        {
            "ready": True,
            "snapshot_based": True,
            "live_whatsapp": False,
            "snapshot": manifest["snapshot"],
            "snapshot_time": manifest["time"],
        }
    )


host = os.environ.get("WHATSAPP_MCP_HOST", "127.0.0.1")
mcp.settings.host = host
mcp.settings.port = 8080
mcp.settings.stateless_http = True
mcp.settings.json_response = True
if host not in {"127.0.0.1", "localhost", "::1", "0.0.0.0", "::"}:
    mcp.settings.transport_security.allowed_hosts.extend([host, f"{host}:*"])
# The private hostname remains an allowed HTTP Host, independently of the
# listening socket. Railway probes can arrive over either address family.
with socket.create_server(
    ("::", 8080), family=socket.AF_INET6, dualstack_ipv6=True
) as listener:
    uvicorn.Server(
        uvicorn.Config(
            mcp.streamable_http_app(),
            host="::",
            port=8080,
            log_level=mcp.settings.log_level.lower(),
        )
    ).run(sockets=[listener])

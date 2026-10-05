#!/usr/bin/env python3
"""Isolated snapshot, tool, restart and actual gateway JWT policy checks."""

import json
import os
import pathlib
import shutil
import sqlite3
import subprocess
import tempfile
import time
import uuid

from seed import SCHEMA, seed

ROOT = pathlib.Path(tempfile.mkdtemp(prefix="wa-trial-guard-")).resolve()
PREFIX = "wa-trial-" + uuid.uuid4().hex[:8]
BACKEND, GATEWAY, JWT, EMPTY = [
    PREFIX + suffix for suffix in ("-data", "-gateway", "-jwt", "-empty")
]
DATA_VOLUME, EMPTY_VOLUME = PREFIX + "-data-volume", PREFIX + "-empty-volume"
IMAGE = os.environ.get("MCP_TEST_IMAGE", "codex-whatsapp-trial:20261005")
GATEWAY_IMAGE = os.environ.get(
    "GATEWAY_TEST_IMAGE", "codex-agentgateway:whatsapp-trial"
)
QUERY_TOOLS = {
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
BLOCKED = {
    "send_message",
    "send_reaction",
    "mark_messages_read",
    "send_file",
    "send_audio_message",
    "download_media",
    "view_media",
    "transcribe_audio",
}
CLIENT = """import json,sys,time,urllib.request,urllib.error,jwt
url,method,params,case=sys.argv[1:]
claims={'iss':'https://issuer.fixture/personal','aud':'https://mcp.janejeon.dev','sub':'fixture-jane','exp':int(time.time())+600,'realm_access':{'roles':['mcp-use']}}
if case=='expired': claims['exp']=int(time.time())-3600
if case=='wrong_audience': claims['aud']='https://wrong.fixture'
if case=='wrong_issuer': claims['iss']='https://wrong.fixture'
if case=='wrong_subject': claims['sub']='fixture-other'
if case=='missing_role': claims['realm_access']={'roles':[]}
if case=='missing_expiration': del claims['exp']
headers={'Content-Type':'application/json','Accept':'application/json, text/event-stream','MCP-Protocol-Version':'2025-06-18'}
if case!='missing_token':
 headers['Authorization']='Bearer '+jwt.encode(claims,open('/fixture/key.pem').read(),algorithm='RS256',headers={'kid':'fixture'})
body=None if method=='GET' else json.dumps({'jsonrpc':'2.0','id':1,'method':method,'params':json.loads(params)}).encode()
request=urllib.request.Request(url,data=body,headers=headers,method='GET' if method=='GET' else 'POST')
try:
 response=urllib.request.urlopen(request,timeout=8); status=response.status
except urllib.error.HTTPError as error: response=error;status=error.code
except Exception as error: print(json.dumps({'status':0,'network_error':type(error).__name__}));raise SystemExit(0)
raw=response.read().decode()
try: value=json.loads(raw)
except json.JSONDecodeError:
 value=None
 for line in raw.splitlines():
  if line.startswith('data:'):
   try: value=json.loads(line[5:])
   except json.JSONDecodeError: pass
print(json.dumps({'status':status,'session':response.headers.get('mcp-session-id'),'body':value}))
"""


def run(*args):
    return subprocess.check_output(args, text=True, stderr=subprocess.STDOUT)


def request(method, params=None, case="valid", url=None):
    return json.loads(
        run(
            "docker",
            "exec",
            JWT,
            "python3",
            "-c",
            CLIENT,
            url or f"http://{GATEWAY}:8080/whatsapp-trial",
            method,
            json.dumps(params or {}),
            case,
        )
    )


def message_read():
    result = request(
        "tools/call",
        {
            "name": "list_messages",
            "arguments": {
                "chat_jid": "fixture@s.whatsapp.net",
                "limit": 5,
                "include_context": False,
            },
        },
    )
    assert result["status"] == 200 and result["session"] is None
    tool = result["body"]["result"]
    assert not tool.get("isError")
    rows = [
        json.loads(block["text"])
        for block in tool["content"]
        if block["type"] == "text"
    ]
    assert [row["content"] for row in rows] == [
        f"Synthetic {i}: café 中文 👋" for i in range(7, 2, -1)
    ]
    assert rows == tool["structuredContent"]["result"]
    return rows


def wait_ready():
    for _ in range(60):
        result = request("GET", url=f"http://{BACKEND}:8080/health")
        if result["status"] == 200:
            return
        time.sleep(0.5)
    raise RuntimeError("Trial readiness never passed")


def startup_rejections():
    check = """import hashlib,json,os,pathlib,shutil,sqlite3
os.environ['WHATSAPP_CANDIDATE_READ_ONLY']='1';os.environ['WHATSAPP_TRIAL_SNAPSHOT']='530656a0'
prefix=pathlib.Path('/app/mcp/trial_serve.py').read_text().split('def require_snapshot():',1)[0]
results={}
for case,expected in [('columns','query schema mismatch'),('counts','row count mismatch'),('foreign_key','foreign key mismatch')]:
 for file in pathlib.Path('/seed').iterdir(): shutil.copyfile(file,pathlib.Path('/app/data')/file.name)
 manifest=json.loads(pathlib.Path('/app/data/snapshot.json').read_text())
 with sqlite3.connect('/app/data/messages.db') as db:
  if case=='columns': db.execute('ALTER TABLE messages DROP COLUMN filename')
  if case=='foreign_key': db.execute("UPDATE messages SET chat_jid='absent@s.whatsapp.net' WHERE id='7'")
 if case=='counts': manifest['messages']+=1
 manifest['sha256']['messages.db']=hashlib.sha256(pathlib.Path('/app/data/messages.db').read_bytes()).hexdigest()
 pathlib.Path('/app/data/snapshot.json').write_text(json.dumps(manifest))
 try: exec(compile(prefix,'actual-shipped-startup-validation','exec'),{})
 except RuntimeError as error:
  assert expected in str(error),str(error);results[case]=str(error)
 else: raise AssertionError('Invalid startup accepted: '+case)
print(json.dumps(results))
"""
    return json.loads(
        run(
            "docker",
            "run",
            "--rm",
            "--platform",
            "linux/amd64",
            "--network",
            "none",
            "--tmpfs",
            "/app/data:rw",
            "--volume",
            f"{ROOT / 'data'}:/seed:ro",
            "--entrypoint",
            "python3",
            "--workdir",
            "/app/mcp",
            IMAGE,
            "-c",
            check,
        )
    )


def main():
    source = ROOT / "source"
    (source / "storages").mkdir(parents=True)
    with sqlite3.connect(source / "storages/whatsapp.db") as db:
        db.executescript(
            "CREATE TABLE whatsmeow_device(secret TEXT); INSERT INTO whatsmeow_device VALUES('synthetic-paired-key-must-not-transfer'); CREATE TABLE whatsmeow_contacts(their_jid TEXT,full_name TEXT,push_name TEXT,first_name TEXT,business_name TEXT); CREATE TABLE whatsmeow_lid_map(lid TEXT,pn TEXT);"
        )
        db.execute(
            "INSERT INTO whatsmeow_contacts VALUES(?,?,?,?,?)",
            ("fixture@s.whatsapp.net", "Fixture Person", "", "", ""),
        )
    with sqlite3.connect(source / "storages/chatstorage.db") as db:
        db.executescript(SCHEMA)
        db.execute("ALTER TABLE chats ADD COLUMN device_id TEXT DEFAULT 'fixture'")
        db.execute("ALTER TABLE messages ADD COLUMN device_id TEXT DEFAULT 'fixture'")
        db.execute(
            "INSERT INTO chats(jid,name,last_message_time) VALUES(?,?,?)",
            ("fixture@s.whatsapp.net", "whatsmeow", "2026-10-05T12:07:00+00:00"),
        )
        for i in range(8):
            db.execute(
                "INSERT INTO messages(id,chat_jid,sender,content,timestamp,is_from_me) VALUES(?,?,?,?,?,?)",
                (
                    str(i),
                    "fixture@s.whatsapp.net",
                    "fixture@s.whatsapp.net",
                    f"Synthetic {i}: café 中文 👋",
                    f"2026-10-05T12:0{i}:00+00:00",
                    False,
                ),
            )
        db.execute("UPDATE messages SET quoted_message_id='6' WHERE id='7'")
    manifest = seed(source, ROOT / "data", "530656a0", "2026-10-05T19:23:48+00:00")
    assert (
        manifest["messages"] == 8 and manifest["paired_device_keys_included"] is False
    )
    with sqlite3.connect(ROOT / "data/messages.db") as db:
        assert db.execute(
            "SELECT quoted_message_id FROM messages WHERE id='7'"
        ).fetchone() == ("6",)
    alias = ROOT / "destination-alias"
    alias.symlink_to(ROOT / "outside", target_is_directory=True)
    try:
        seed(source, alias / "must-not-create", "530656a0", "2026-10-05T19:23:48+00:00")
    except ValueError:
        assert not (ROOT / "outside").exists()
    else:
        raise AssertionError("Seed allowed a symlinked destination ancestor")
    assert set(p.name for p in (ROOT / "data").iterdir()) == {
        "messages.db",
        "contacts.db",
        "snapshot.json",
        ".snapshot-ready",
    }
    startup_errors = startup_rejections()
    run(
        "openssl",
        "genpkey",
        "-algorithm",
        "RSA",
        "-pkeyopt",
        "rsa_keygen_bits:2048",
        "-out",
        str(ROOT / "key.pem"),
    )
    (ROOT / "key.pem").chmod(0o600)
    run("docker", "network", "create", "--internal", PREFIX)
    jwks_server = """import base64,json
from http.server import BaseHTTPRequestHandler,HTTPServer
from cryptography.hazmat.primitives.serialization import load_pem_private_key
n=load_pem_private_key(open('/fixture/key.pem','rb').read(),password=None).public_key().public_numbers()
def enc(value):return base64.urlsafe_b64encode(value.to_bytes((value.bit_length()+7)//8,'big')).decode().rstrip('=')
data=json.dumps({'keys':[{'kty':'RSA','use':'sig','alg':'RS256','kid':'fixture','n':enc(n.n),'e':enc(n.e)}]}).encode()
class Handler(BaseHTTPRequestHandler):
 def do_GET(self):self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(data)
 def log_message(self,*args):pass
HTTPServer(('0.0.0.0',9911),Handler).serve_forever()
"""
    run(
        "docker",
        "run",
        "-d",
        "--name",
        JWT,
        "--network",
        PREFIX,
        "--volume",
        f"{ROOT}:/fixture:ro",
        "--entrypoint",
        "python3",
        IMAGE,
        "-c",
        jwks_server,
    )
    for attempt in range(60):
        probe = subprocess.run(
            [
                "docker",
                "exec",
                JWT,
                "python3",
                "-c",
                "import socket; socket.create_connection(('127.0.0.1',9911),timeout=1).close()",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        if probe.returncode == 0:
            break
        if attempt == 59:
            raise RuntimeError("Fixture JWKS listener did not start")
        time.sleep(0.25)
    run("docker", "volume", "create", DATA_VOLUME)
    run("docker", "volume", "create", EMPTY_VOLUME)
    run(
        "docker",
        "run",
        "--rm",
        "--volume",
        f"{DATA_VOLUME}:/app/data",
        "--volume",
        f"{ROOT / 'data'}:/seed:ro",
        "--entrypoint",
        "sh",
        IMAGE,
        "-c",
        "cp -a /seed/. /app/data/",
    )
    for name, data in ((BACKEND, DATA_VOLUME), (EMPTY, EMPTY_VOLUME)):
        run(
            "docker",
            "run",
            "-d",
            "--name",
            name,
            "--network",
            PREFIX,
            "--volume",
            f"{data}:/app/data",
            "--env",
            "WHATSAPP_CANDIDATE_READ_ONLY=1",
            "--env",
            "WHATSAPP_TRIAL_SNAPSHOT=530656a0",
            "--env",
            f"WHATSAPP_MCP_HOST={name}",
            IMAGE,
        )
    env = {
        "TELEGRAM_MCP_URL": f"http://{BACKEND}:8080/mcp",
        "WHATSAPP_MCP_HOST": BACKEND,
        "WHATSAPP_TRIAL_MCP_URL": f"http://{BACKEND}:8080/mcp",
        "KEYCLOAK_MCP_URL": f"http://{BACKEND}:8080/mcp",
        "KEYCLOAK_HOST": f"{JWT}:9911",
        "OIDC_ISSUER": "https://issuer.fixture/personal",
        "OIDC_JWKS_URL": f"http://{JWT}:9911/jwks",
        "MCP_ALLOWED_SUB": "fixture-jane",
    }
    config = (
        pathlib.Path(__file__).resolve().parents[1] / "agentgateway/config.yaml"
    ).read_text()
    route_mode = "repository route"
    if "  - name: whatsapp-trial\n" not in config:
        route_mode = "fixture derived from existing production WhatsApp policy"
        original = (
            "  - name: whatsapp\n"
            + config.split("  - name: whatsapp\n", 1)[1].split(
                "  - name: keycloak-management\n", 1
            )[0]
        )
        trial = original.replace("whatsapp", "whatsapp-trial")
        transport = "              sse:\n                host: ${WHATSAPP_MCP_HOST}\n                port: 8080\n                path: /sse\n"
        assert transport in trial
        trial = trial.replace(
            transport,
            "              mcp:\n                host: ${WHATSAPP_TRIAL_MCP_URL}\n",
        )
        trial = trial.replace(
            "pathPrefix: /.well-known/oauth-protected-resource/whatsapp-trial",
            "exact: /.well-known/oauth-protected-resource/whatsapp-trial",
        )
        config = config.replace(
            "  - name: whatsapp\n", trial + "  - name: whatsapp\n", 1
        )
    (ROOT / "gateway-fixture.yaml").write_text(config)
    args = [
        "docker",
        "run",
        "-d",
        "--name",
        GATEWAY,
        "--network",
        PREFIX,
        "--volume",
        f"{ROOT / 'gateway-fixture.yaml'}:/config.yaml:ro",
    ]
    for name, value in env.items():
        args.extend(["--env", f"{name}={value}"])
    run(*args, GATEWAY_IMAGE)
    wait_ready()
    permissions = json.loads(
        run(
            "docker",
            "exec",
            BACKEND,
            "python3",
            "-c",
            "import os,stat,json;paths=['/app/data','/app/data/messages.db','/app/data/contacts.db','/app/data/snapshot.json','/app/data/.snapshot-ready'];print(json.dumps({p:{'uid':os.stat(p).st_uid,'gid':os.stat(p).st_gid,'mode':oct(stat.S_IMODE(os.stat(p).st_mode))} for p in paths}))",
        )
    )
    assert all(
        v["uid"] == 0
        and v["gid"] == 20000
        and v["mode"] == ("0o550" if p == "/app/data" else "0o440")
        for p, v in permissions.items()
    ), permissions
    process_uid = run(
        "docker",
        "exec",
        BACKEND,
        "python3",
        "-c",
        "print(next(line for line in open('/proc/1/status') if line.startswith('Uid:')).split()[1])",
    ).strip()
    assert process_uid == "20001", process_uid
    for attempt in range(60):
        inventory = request("tools/list")
        if inventory["status"] == 200 and inventory.get("body", {}).get("result"):
            break
        time.sleep(0.5)
    tools = inventory["body"]["result"]["tools"]
    assert {tool["name"] for tool in tools} == QUERY_TOOLS
    assert all(tool["annotations"]["readOnlyHint"] for tool in tools)
    auth = {}
    for case in (
        "missing_token",
        "expired",
        "wrong_audience",
        "wrong_issuer",
        "wrong_subject",
        "missing_role",
        "missing_expiration",
    ):
        auth[case] = request("tools/list", case=case)["status"]
        assert auth[case] in (401, 403), (case, auth[case])
    metadata = request(
        "GET",
        case="missing_token",
        url=f"http://{GATEWAY}:8080/.well-known/oauth-protected-resource/whatsapp-trial",
    )
    assert (
        metadata["status"] == 200
        and metadata["body"]["resource"] == "https://mcp.janejeon.dev/whatsapp-trial"
    )
    before = message_read()
    assert before[0]["quoted_message_id"] == "6"
    context = request(
        "tools/call",
        {
            "name": "get_message_context",
            "arguments": {"message_id": "7", "before": 1, "after": 0},
        },
    )
    assert (
        context["body"]["result"]["structuredContent"]["message"]["quoted_message_id"]
        == "6"
    )
    for name in BLOCKED:
        response = request("tools/call", {"name": name, "arguments": {}})
        assert response["body"].get("error") or response["body"]["result"].get(
            "isError"
        ), name
    denied = run(
        "docker",
        "exec",
        "--user",
        "20001:20000",
        BACKEND,
        "python3",
        "-c",
        "import sqlite3;\ntry:\n sqlite3.connect('/app/data/messages.db').execute(\"DELETE FROM messages\")\nexcept sqlite3.OperationalError: print('readonly_denied')\nelse: raise SystemExit(1)",
    )
    assert denied.strip() == "readonly_denied"
    assert request("GET", url=f"http://{EMPTY}:8080/health")["status"] != 200
    run(
        "docker",
        "exec",
        BACKEND,
        "sh",
        "-c",
        "test ! -e /app/whatsapp-bridge && test ! -e /usr/local/bin/backup-loop.sh",
    )
    gateway_start = run(
        "docker", "inspect", GATEWAY, "--format", "{{.State.StartedAt}}"
    )
    run("docker", "restart", BACKEND)
    wait_ready()
    assert message_read() == before
    assert (
        run("docker", "inspect", GATEWAY, "--format", "{{.State.StartedAt}}")
        == gateway_start
    )
    injection = run(
        "docker",
        "exec",
        BACKEND,
        "python3",
        "-c",
        "import os,json;os.rename('/app/data/messages.db','/app/data/messages.hidden');print(json.dumps({'old_exists':os.path.exists('/app/data/messages.db'),'renamed_exists':os.path.exists('/app/data/messages.hidden')}))",
    )
    injection = json.loads(injection)
    assert injection == {"old_exists": False, "renamed_exists": True}, injection
    removed_health = request("GET", url=f"http://{BACKEND}:8080/health")
    assert removed_health["status"] == 503, removed_health
    missing = request(
        "tools/call", {"name": "list_messages", "arguments": {"limit": 1}}
    )
    assert missing["body"]["result"].get("isError")
    print(
        json.dumps(
            {
                "image": IMAGE,
                "image_id": run(
                    "docker", "image", "inspect", IMAGE, "--format", "{{.Id}}"
                ).strip(),
                "query_tools": len(tools),
                "blocked_tools": len(BLOCKED),
                "auth_denials": auth,
                "expired_token_age_seconds": 3600,
                "gateway_config": route_mode,
                "symlinked_destination_rejected": True,
                "quoted_message_id_preserved": True,
                "resource_metadata": "whatsapp-trial",
                "snapshot_rows_before_after_restart": len(before),
                "gateway_restarted": False,
                "paired_device_keys_in_seed": False,
                "runtime_database_write_denied": True,
                "missing_seed_not_ready": True,
                "missing_database_health_status": 503,
                "missing_database_fault_injection": injection,
                "missing_database_call_is_error": True,
                "bridge_and_backup_absent": True,
                "network": "internal",
                "data_mount": "Linux named volume",
                "runtime_uid": int(process_uid),
                "permissions": permissions,
                "startup_rejections": startup_errors,
                "data": "synthetic",
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    try:
        main()
    except BaseException as failure:
        if isinstance(failure, subprocess.CalledProcessError):
            print(failure.output[-5000:])
        for name in (BACKEND, GATEWAY):
            logs = subprocess.run(
                ["docker", "logs", name], capture_output=True, text=True
            )
            print(name + ": " + (logs.stdout + logs.stderr)[-5000:])
        raise
    finally:
        for name in (BACKEND, GATEWAY, JWT, EMPTY):
            subprocess.run(
                ["docker", "rm", "-f", name],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        subprocess.run(
            ["docker", "network", "rm", PREFIX],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        for volume in (DATA_VOLUME, EMPTY_VOLUME):
            subprocess.run(
                ["docker", "volume", "rm", volume],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        shutil.rmtree(ROOT)

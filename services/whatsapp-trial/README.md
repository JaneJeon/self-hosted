# WhatsApp snapshot trial

This service reads an immutable copied snapshot. It never pairs, connects to WhatsApp, sends messages, marks them read, downloads media or runs backups. Keep the production WhatsApp service and its volume untouched.

The trial packages the Python tools from [verygoodplugins/whatsapp-mcp](https://github.com/verygoodplugins/whatsapp-mcp/tree/895404542017f34a900f9f572a5497c275a96440). Its separate Railway service and volume prepare native client testing before a production replacement is accepted. Source follows master with this directory as its root and the standard Dockerfile. Phase 1 provisions the private service and its gateway URL reference. After private seed validation, phase 2 adds the protected `/whatsapp-trial` route. Only the existing agentgateway has a public domain.

## Evaluation decision — October 7, 2026

Retain the production GOWA service and its 40 tools. The maintained fork provides
17 tools and omits device, group and administrative operations. The immutable
query trial proved its nine query schemas and actual message text in native
Codex, including five rows matching source SQL. It does not establish live
pairing, complete media migration or rollback after new messages arrive.
ChatGPT/Claude trial checks are pending specific browser approval.

This directory remains an offline evaluation fixture. Retirement removes its
Railway service, protected route and gateway reference; the detached volume
requires explicit deletion of the trial volume alone. Do not deploy this
snapshot as the personal live WhatsApp connector.

## Query and runtime boundaries

The server exposes exactly nine upstream queries: `search_contacts`, `get_contact`, `list_messages`, `list_chats`, `get_chat`, `get_direct_chat_by_contact`, `get_contact_chats`, `get_last_interaction` and `get_message_context`. Other upstream tools are removed. Cached or handcrafted calls to a removed name fail. Query tools retain their input schemas and receive read-only annotations and a dated snapshot warning.

The image contains no Go bridge or backup executable. Startup requires `WHATSAPP_CANDIDATE_READ_ONLY=1`. Runtime SQLite connections are confined to `messages.db` and `contacts.db` using `mode=ro&immutable=1`; filesystem permissions also prohibit writes by UID 20001. HTTP requests through the upstream client are blocked. The trial has no B2, heartbeat, bridge-token or paired-device credentials.

The manifest records the reviewed source snapshot, timestamp, row counts and file digests. Startup rejects an identity/checksum/schema mismatch or corrupt database. `/health` succeeds only after the loaded files pass validation; removing or changing a snapshot file makes readiness fail and query calls return errors. The server's instructions and tool descriptions identify the data as snapshot-based, not live. Imported read markers are unknown, so do not treat returned `unread` flags as verified current read state.

Set Railway `PORT=8080` explicitly. The pinned server and `MCP_URL` use port 8080; [Railway health probes use `PORT`](https://docs.railway.com/deployments/healthchecks). An absent or mismatched value can prevent `/health` from reaching the listener even after Uvicorn starts successfully.

The listener uses an explicit IPv6 socket with IPv4 support (`IPV6_V6ONLY=0`) on port 8080. The private hostname is an allowed HTTP Host; it does not determine the listening address. `/health` accepts Railway's probe hostname over both loopback address families. No local `/etc/hosts` mapping is needed for this native HTTP listener.

## Prepare the seed privately

The selected source is ordinary snapshot `530656a0`, independently restored and validated by the parent. Use its actual restic timestamp, not the example fixture timestamp. Restore into disposable RAM through the existing backup recovery workflow, using cached service direnv credentials. Do not copy the running production databases.

Run the seed helper against the consistent restored `storages/` directory:

```bash
python3 services/whatsapp-trial/seed.py /private/restored/whatsapp-mcp /private/new-trial --snapshot 530656a0 --time '<timestamp-from-restic-metadata>'
```

The destination must be new, outside the source, and have no symlink ancestor. The helper copies message/query fields (including quoted-message IDs when present), contact names and phone/LID mappings. It excludes paired-device/authentication tables, media encryption keys, remote media URLs, original history extras and original files. It validates SQLite and writes a marker last. Its output contains exactly `messages.db`, `contacts.db`, `snapshot.json` and `.snapshot-ready`.

Keep the transfer archive private, outside Git and browser uploads:

```bash
umask 077
tar -C /private/new-trial -cf /private/whatsapp-trial.tar messages.db contacts.db snapshot.json
shasum -a 256 /private/whatsapp-trial.tar
```

The ready marker is deliberately excluded. Never upload the original WhatsApp database or the full source snapshot to this trial volume.

## Provision and transfer

The parent owns reviewed merge, live provisioning and consumer grants. Inspect the exact pinned plan before applying: the trial adds one private service, one volume and one gateway URL reference. Record the three existing gateway reference setters separately; the target expressions are already stored, while the planner marks them with deployment effects. The model matches Railway's stored build/deploy defaults to avoid updates to every existing service. Railway [detects each standard Dockerfile automatically](https://docs.railway.com/builds/dockerfiles). The dry plan is not a deployment.

Merge/apply phase 1 and load the private seed before merging phase 2's route. This keeps the gateway URL reference available before a runtime uses it. Initially leave Railway's deployment healthcheck unset: the entrypoint waits for its marker, and the empty service is not MCP-ready. Enabling `/health` before transferring the seed makes the first deployment fail while file/SSH access is unavailable. After transfer and private readiness validation, restore Railway's `/health` gate with its 180-second timeout before publishing the route. The server's readiness and immutable-data checks stay enabled throughout.

Upload with the account-scoped Railway CLI from this service directory, passing the service/volume explicitly until linked:

```bash
railway volume files --volume whatsapp-trial-volume upload /private/whatsapp-trial.tar /snapshot.tar
railway ssh --service 'Whatsapp Trial' -- 'sha256sum /app/data/snapshot.tar'
```

The volume CLI's `/` corresponds to `/app/data` in the container. Compare the uploaded archive digest with the local digest. Check its entry names are exactly the three expected files, extract them to `/app/data`, then remove the uploaded tar. The waiting entrypoint has not started the query server. Check both databases with Python SQLite `PRAGMA quick_check` and verify the manifest's two SHA-256 values. Upload `.snapshot-ready` last. Startup then changes ownership/permissions and independently repeats manifest, schema and database validation.

Confirm the private `/health` reports the expected snapshot/time and `live_whatsapp: false`. Only then add phase 2's gateway route with the same issuer, audience, permanent Jane subject and `mcp-use` role as production. Its protected-resource metadata must name `https://mcp.janejeon.dev/whatsapp-trial`, and authorization headers must be removed before private backend requests. No public backend domain is needed.

## Verification and acceptance

```bash
docker build --platform linux/amd64 -t codex-whatsapp-trial:20261005 services/whatsapp-trial
docker build -t codex-agentgateway:whatsapp-trial services/agentgateway
python3 services/whatsapp-trial/test.py
```

The fixture uses synthetic data and an internal Docker network. Phase 1 derives a proposed trial route from the current production WhatsApp policy; phase 2 tests the actual repository route. It checks nine queries, rejection of eight removed operations, seven invalid-token cases, resource metadata, actual JSON message rows, filesystem/SQLite write denial, missing data readiness and backend restart without restarting the gateway. The expiry fixture uses a token expired one hour earlier, beyond the pinned JWT library's 60-second tolerance. The existing pre-push hook blocks Docker build failures. CI separately runs the fixture on native AMD64; it is not a required merge or deployment gate.

After the endpoint is published, the parent obtains the new consumer grants and runs actual reads in ChatGPT, Claude and Codex. Those clients must discover the nine trial schemas, receive real message contents and retain the snapshot warning. Local fixture results cannot establish native client use. Accepting this remote query trial does not accept a production replacement.

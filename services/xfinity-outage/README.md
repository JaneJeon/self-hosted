## Xfinity Outage Monitor

Checks the Xfinity Status Center API every 15 minutes for outage status at your home address. Sends a Telegram notification when something changes: new outage detected, outage resolved, ETR shifted, or outage type reclassified. Does not re-notify for the same ongoing outage.

Runs externally on Railway (not from Home Assistant) because the whole point is monitoring home internet — if the internet is down, a local check can't reach external APIs.

### How it works

1. Gets a session token from the Xfinity outage API (unauthenticated, no login needed)
2. Queries outage status for the configured address
3. Compares against the last known state (persisted via the configured store)
4. If the state changed, sends a Telegram message describing what happened
5. Saves the new state
6. Pings Uptime Kuma on success (missed pings trigger an alert)

### Upstream flakiness and retries

The Xfinity API intermittently returns `HTTP 500` with body `{"error": {"errorCode": 500, "errorMessage": "internalerror: Error contacting backend"}}`. During a degradation on 2026-07-17 it failed roughly 40% of calls. The 500s correlate with ~11-20s latency; healthy calls return in ~2s.

Both Xfinity calls are wrapped in `withRetry` ([retry.mjs](retry.mjs)) — 5 attempts, exponential backoff with jitter, and a 15s per-attempt timeout. Only transient failures retry: 5xx, timeouts, and socket errors. A **4xx is not retried** — it means the address or API contract changed, which is a real bug that should surface.

Retries exist because there is no infrastructure safety net: Railway forces `restartPolicyType: NEVER` on cron services, so the `ON_FAILURE` policy in [railway.json](railway.json) is silently ignored (see [AGENTS.md](../../AGENTS.md)). A crashed run is simply a missed run.

The heartbeat is deliberately only pinged on success. A page therefore means a _sustained_ upstream failure or a real bug — not a single blip. That is intentional: if the API is genuinely down, this service is blind and you should know.

### Heartbeat failures

A failed heartbeat is a _monitoring_ fault, not a failed run: by the time it is
sent, the outage check has already succeeded and the new state is saved.

It used to throw, which surfaced as `unhandled error` and made a broken
`HEARTBEAT_URL` indistinguishable from a broken outage check. On 2026-08-26 the
push URL began returning `HTTP 404` and the service "crashed" three times in a
row while the actual monitoring worked perfectly.

Now the ping is retried under the same policy as the Xfinity calls, and a
persistent failure is logged as `heartbeat failed - watchdog is blind` with a
non-zero exit code so Railway still flags it. A 404 is deliberately not
retried: it means the push monitor no longer exists, so Uptime Kuma cannot
distinguish "this cron is broken" from "this cron was deleted" — which is
exactly the silent failure this service exists to avoid.

### Tests

`npm test` (or `node --test`) — no dependencies beyond Node's built-in test runner. Covers the retry policy, including a real HTTP 500 retried over a socket.

### Environment variables

| Variable             | Required | Purpose                                     |
| -------------------- | -------- | ------------------------------------------- |
| `HOME_ADDRESS`       | Yes      | URL-encoded street address (Xfinity format) |
| `TELEGRAM_BOT_TOKEN` | Yes      | Telegram Bot API token                      |
| `TELEGRAM_CHAT_ID`   | Yes      | Telegram chat ID for notifications          |
| `HEARTBEAT_URL`      | No       | Uptime Kuma push monitor URL                |

### Volume

Mount at `/data`. The default file store writes `last_state.json` here to track outage state across runs.

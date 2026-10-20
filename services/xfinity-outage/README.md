## Xfinity Outage Monitor

Checks the Xfinity Status Center API every 15 minutes for outage status at your home address. Sends a Telegram notification when something changes: new outage detected, outage cleared, restore estimate posted or moved, or outage type reclassified. A dropped restore estimate is logged but not sent. Does not re-notify for the same ongoing outage.

Why it handles a clearing outage and the building check this way, the 2026-10-19 and 2026-10-20 evidence behind them, and what is still unknown: Craft, `Workspace/Xfinity outage monitor cleared-outage message — 2026-10-19`.

Runs externally on Railway (not from Home Assistant) because the whole point is monitoring home internet — if the internet is down, a local check can't reach external APIs.

### How it works

1. Gets a session token from the Xfinity outage API (unauthenticated, no login needed)
2. Queries outage status for the configured address
3. Checks up to 5 other apartments in the same building (see [Building check](#building-check))
4. Compares against the last known state (persisted via the configured store)
5. If the state changed in a way worth telling you, sends a Telegram message describing what happened. A dropped estimate or outage type is logged, not sent
6. Saves the new state
7. Pings Uptime Kuma on success (missed pings trigger an alert)

### Building check

Xfinity attaches the same outage ID to every affected unit, so neighbors show whether an outage is shared or only at the home address.

- Neighbors come from Xfinity's address typeahead, queried with `HOME_ADDRESS` minus its unit number. Only plain `APT <number>` units on the same street, city, state and ZIP count: business lines such as `UNIT HMOFC` or `APT 710-HMOFC`, duplicates and the home unit are dropped. At most 5 are checked. An address without a unit turns the check off. There is no setting.
- A neighbor's 404 ("Xfinity service is not found") means no Xfinity there, so it is not counted. Planned maintenance does not count as an outage.
- A building outage starts when 2 or more neighbors list one outage ID, and lasts until none do, so a count at the threshold does not flap.
- The home "Internet is down" message says how many neighbors share the outage. When the home address lists nothing but neighbors share one, "Outage in your building" goes out, then "Building outage cleared". When the home address lists the same outage, now or at the previous check, the home messages cover it and no building message is sent.
- It is best-effort: one attempt per call and a 20-second budget for the whole check, so the heartbeat is never late. A failed lookup, a malformed answer or no neighbor answering means no building decision that run, and the reason is logged.
- Neighbor addresses never go into the logs or the state file, only counts and outage IDs. The logged `customerMessage` leaves out its free-text `messages`, which name the street address, and a body that is not JSON is never quoted in an error.

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
service "crashed" three runs in a row (22:15, 22:33, 22:47 UTC) while the actual
monitoring worked perfectly.

**Root cause of those 404s — it was not our URL.** Uptime Kuma failed to write
its hourly rollup for this monitor and restarted the monitor to recover:

```
Duplicate entry '7-1787781600' for key 'stat_hourly.stat_hourly_monitor_id_timestamp_unique'
[MONITOR] ERROR: Please report to https://github.com/louislam/uptime-kuma/issues
[MONITOR] INFO: Try to restart the monitor
```

Monitor `#7` is this service's push monitor and `1787781600` is the 22:00 UTC
hour bucket. Kuma hit that collision 8 times and restarted the monitor 4 times
within that hour; while a monitor is restarting its push route returns **404**.
Once the clock rolled into the 23:00 bucket the collision stopped and heartbeats
resumed on the _same, unchanged_ URL.

So a 404 here is **not** evidence the monitor was deleted, and the heartbeat
therefore retries everything — 4xx included — via `transient: () => true`. A
wasted retry on a fire-and-forget ping costs nothing, whereas treating a
transient 404 as fatal cost three crashed runs. The Xfinity API calls keep the
default policy, where a 4xx really does mean the contract changed.

If the retries are exhausted, it is logged as
`heartbeat failed - watchdog is blind` with a non-zero exit code so Railway
still flags it.

### Why the graph shows occasional yellow

The Uptime Kuma monitor uses a 960s (16 min) window against a 15 min cron, so a
single skipped or delayed Railway run trips `Pending`. Kuma only alerts after
two consecutive misses, so these show as yellow bars and correctly do not page.

### Tests

`npm test` (or `node --test`) — no dependencies beyond Node's built-in test runner. `retry.test.mjs` covers the retry policy, including a real HTTP 500 retried over a socket. `building.test.mjs` covers the neighbor filter, the 404 and malformed-body rules, every building transition including flapping, staged clearing and a different home outage, HTML escaping, and the first run on state saved before the check existed. `changes.test.mjs` covers every restore-estimate and outage-type transition, the 2026-10-19 sequence end to end, and checks that a missing or unreadable estimate or type never shows as `null`, `Invalid Date` or `unknown time`. A missing start time is not covered: messages other than "back" still say "unknown time" for it.

### Environment variables

| Variable             | Required | Purpose                                     |
| -------------------- | -------- | ------------------------------------------- |
| `HOME_ADDRESS`       | Yes      | URL-encoded street address (Xfinity format) |
| `TELEGRAM_BOT_TOKEN` | Yes      | Telegram Bot API token                      |
| `TELEGRAM_CHAT_ID`   | Yes      | Telegram chat ID for notifications          |
| `HEARTBEAT_URL`      | No       | Uptime Kuma push monitor URL                |

### Volume

Mount at `/data`. The default file store writes `last_state.json` here to track outage state across runs.

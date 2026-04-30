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

### Environment variables

| Variable             | Required | Purpose                                     |
| -------------------- | -------- | ------------------------------------------- |
| `HOME_ADDRESS`       | Yes      | URL-encoded street address (Xfinity format) |
| `TELEGRAM_BOT_TOKEN` | Yes      | Telegram Bot API token                      |
| `TELEGRAM_CHAT_ID`   | Yes      | Telegram chat ID for notifications          |
| `HEARTBEAT_URL`      | No       | Uptime Kuma push monitor URL                |

### Volume

Mount at `/data`. The default file store writes `last_state.json` here to track outage state across runs.

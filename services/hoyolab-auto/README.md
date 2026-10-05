## Volume

Mounts at `/app/data`.

## Environment Variables

NOTE: all of the uptime kuma URLs are in forms of `http://${{"Uptime Kuma".RAILWAY_PRIVATE_DOMAIN}}:${{"Uptime Kuma".PORT}}/api/push/<monitor_id>`.

DO NOT MANUALLY SET THE DOMAIN, DO NOT WILLY NILLY OVERWRITE THE URLs!

Also you CANNOT have the `https://` prefix if using the Railway private domains like this!

## Notification routing and reminders

`TELEGRAM_NOTIFICATIONS_BOT_TOKEN` / `TELEGRAM_CHAT_ID` receive Receipt messages
silently. `TELEGRAM_ALERTS_BOT_TOKEN` / `TELEGRAM_ALERTS_CHAT_ID` receive Action
pings. Tokens are maintained in 1Password and injected through Railway stdin;
all four variable names must remain in the Dockerfile's runtime envsubst list.
Commands, including `/tasks`, reply only in their originating bot/chat.

The deadline coordinator checks live notes every two minutes and at startup.
Daily reminders use T-20/12/7/4/2 hours relative to each account's 04:00 game
server reset. The state and delivered-rung ledger persist at
`/app/data/reminders.json` on the existing volume. Completion cancels later
rungs; missing or stale evidence is unknown. Display zones never silence pings.

Weekly offsets are intentionally not configured yet: the three-hour estimate
needs clarification (combined workload or per game). The legacy weekly cron
continues until that policy is settled. The current task view already includes
fresh weekly progress. Do not mark the weekly acceptance work complete.

The three Kuma monitors retain their existing private HTTP references. They
cover process and credential health, not fresh-notes or delivery correctness;
that coverage remains a separate monitoring task.

### Current weekly objects

The task view and legacy weekly emitter use the current game mechanics:
Star Rail tracks Echo of War plus the unified Cyclical Points track; Zenless
tracks Lost Void Bounty plus Ridu Weekly. Legacy mode counters and the retired
Investigation Points weekly limit do not create extra obligations. Missing
progress for an actual obligation remains unknown. See
[application PR #15](https://github.com/JaneJeon/hoyolab-auto/pull/15) for the
live-response evidence, official update references, and regression coverage.

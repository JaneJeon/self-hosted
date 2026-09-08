## codex-reset-watch

Watches [codex-resets.com](https://codex-resets.com/api/docs) for upcoming
Codex weekly usage-limit resets, projects at most one event onto the Fastmail
`Events` calendar over CalDAV, and sends one Telegram message per meaningful
change. Replaces a deleted ChatGPT Scheduled task (JANE-240).

Runs on a cron, roughly every two hours. A poll that finds nothing new writes
nothing and says nothing.

### What it decides

The tracker exposes three things that matter: `latest_reset` (what has already
happened), `scheduled_reset` (a human announcement awaiting execution), and
`active_watch` (the tracker's own AI forecast). Only `regular` resets count;
`banked` ones are credits, not resets, and are ignored.

**Confirmed means a person announced it, not that it happened.** A watch is a
forecast, so it gets the `(Unconfirmed)` title. A scheduled reset sourced from
an X post is a human announcement, so it gets `(Confirmed)`. Completion is a
separate, later event, detected by a new `latest_reset.id`. That reading is
what lets the issue's "unconfirmed to confirmed" and "observed completion" be
two distinct notifications while never treating `status: scheduled` as proof
the reset occurred, which the tracker's own spec warns against.

### Why it refuses instead of guessing

`window.mjs` derives the time window. Its patterns were built by reading all 52
historical announcements, not from the issue text, and two findings shaped it.

The dominant real form is a duration from the announcement ("Lands in the next
hour"), not a clock time. No record ever used "by \<time\>".

Five real expressions would fool an unanchored parser: a percentage ("usage
dropped around 10%"), an outage ("last night around 2am to 4am"), a fix
duration ("fixed in ~8 mins"), an eligibility deadline ("before 8pm PT"), and a
bank credit period ("over the next 24 hours"). Each would have written a wrong
window to a real calendar. So a time only counts inside a clause that also says
the reset is landing, and each of those five has a regression test.

Anything time-shaped that no pattern matches returns _unparseable_ rather than
empty, and that withholds a heartbeat. An alert plus a logged sample costs one
look. An invented calendar entry costs trust.

`active_watch.forecast_window` is typed only as `string` in the OpenAPI spec,
with no format and no example, and no live sample has ever been observed. The
allowlist is a starting point; every unparseable value is logged in full so it
can be extended from real data rather than guesses.

### When it will not act

If the service cannot classify what it sees, it changes nothing outside itself.
It does not delete an event it cannot reason about and it does not message. It
goes quiet, and the missing heartbeat is the signal.

A disappearing signal is only a safe withdrawal when stored state proves it. A
watch carries `expires_at`, so a forecast that vanishes after its own stated
expiry told us in advance it would stop being valid. A `scheduled_reset`
carries no expiry, so its disappearance is never provably safe.

### Health

Four push monitors, because one aggregate signal cannot say which thing broke.

| Variable                 | Fires when                                       |
| ------------------------ | ------------------------------------------------ |
| `KUMA_PUSH_URL_LIVENESS` | the run completed at all, whatever it found      |
| `KUMA_PUSH_URL_DOMAIN`   | the state was classifiable and the window parsed |
| `KUMA_PUSH_URL_CALDAV`   | the calendar query succeeded                     |
| `KUMA_PUSH_URL_TELEGRAM` | `getMe` confirmed the bot identity               |

The CalDAV and Telegram probes run every cycle, not only when there is
something to write. Those legs otherwise only execute on a transition, and
resets are about a week apart, so a dead credential would stay invisible for
days. See `Library/Playbooks/My service is green but one of its features
quietly stopped` in Craft for the incident this pattern comes from.

The service never alerts. Kuma decides up or down; PagerDuty decides urgency.
Telegram carries domain changes only, never failures.

Monitor settings: heartbeat interval 8100s against the 2h cron, Retries 1,
notification `PagerDuty Alerts - Railway Stack`. That is 900s of slack, matching
what hoyolab-auto allows rather than the tighter ratio xfinity-outage uses,
because at a two-hour cadence a proportional margin trips on ordinary dispatch
jitter and trains you to ignore yellow. Occasional yellow `Pending` bars are
expected and correctly do not page.

### Environment variables

| Variable                                 | Notes                                                                                                                |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `CALDAV_CALENDAR_URL`                    | The `Events` collection. Not a secret; set in `.env.template`.                                                       |
| `CALDAV_USERNAME`, `CALDAV_PASSWORD`     | Fastmail app password scoped to CalDAV only.                                                                         |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Shared `Telegram Alerts Bot`.                                                                                        |
| `KUMA_PUSH_URL_*`                        | Optional. A missing one just skips that signal.                                                                      |
| `DRY_RUN`                                | Any non-empty value. Reads happen, writes are logged and skipped, heartbeats still fire, and **state is not saved**. |

Dry run deliberately skips the save: recording a projection for an event that
was never created would make the service skip the create on the day writes are
switched on.

### Volume

Mount at `/data`. `last_state.json` holds everything the transition rules read,
so a lost volume means the next run adopts whatever is on the calendar rather
than duplicating or deleting it.

```bash
railway service link codex-reset-watch
railway volume add --mount-path /data
```

### Tests

`npm test`, or `node --test`. 107 tests, no dependencies beyond Node's runner.
Anything over the wire runs against a real `node:http` server on port 0, which
is the pattern xfinity-outage established.

CI runs prettier only, so `npm test` and the pre-push `docker build` are the
real gates.

One test reads the Dockerfile and asserts its `COPY` list matches the runtime
modules exactly. A file missing from that line survives every other test and
crashes only in production, which is what happened on 2026-08-28.

`retry.mjs` is duplicated from `xfinity-outage` rather than shared. The
pre-push hook builds each service with its own directory as the Docker
context, so a repo-root module cannot be copied into the image. A third
consumer is the signal to extract a package.

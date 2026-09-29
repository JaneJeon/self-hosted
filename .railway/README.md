# MCP Railway infrastructure

`railway.ts` owns only the three MCP services and their two volumes through the
named `mcp` partial. It preserves credentials already injected into Railway;
secret values belong in 1Password and never in this file. The existing services
are outside this partial.

Represent service dependencies with Railway reference variables. Use private
domains and the provider's variables so values update together and the canvas
shows the actual dependency. The gateway references both MCP backends, and
WhatsApp's heartbeat references Uptime Kuma's private domain and port. Its
secret push path stays in a separate preserved variable, never in source.

Match the existing dashboard service names in the IaC declarations and check
that the plan updates those services instead of creating duplicates. References
between owned services use SDK handles, which resolve the provider's name. References to existing services outside this partial use Railway's
template syntax without taking ownership of those services.

Run `railway config plan` from a linked MCP service directory before committing
changes. `.github/workflows/railway-mcp.yml` applies this partial on `git push`
using a project-scoped production token stored in GitHub Actions and 1Password.
The workflow does not allow destructive applies without a separate change.
Once each GitHub source is connected, service code deploys from pushes to its
connected branch.

When rotating WhatsApp's monitor URL in 1Password, derive `KUMA_PUSH_PATH` from
its path and query and send it through Railway stdin. Keep `HEARTBEAT_URL` as
the reference expression. The full URL in 1Password remains the source for
local backup tests.

# MCP Railway infrastructure

`railway.ts` owns the MCP services, private identity services, messaging volumes
and the existing Tailscale router settings/state for private browser administration
through the named `mcp` partial. It preserves credentials injected into Railway;
secret values never belong in this file. Permanent credentials belong in
1Password. Keycloak database and private maintenance credentials are sourced
from `Self Hosting/Railway Keycloak` through the service's swarp/direnv template.
The working Jane password remains in `Self Hosting/MCP Gateway Auth`.
Other existing services are outside this partial. The router declaration preserves
its current credential/network variables and rat-volume; its console URL supplies
Keycloak through a reference. Do not adopt existing services with empty variable
or volume definitions: a thin declaration can propose deleting their state.

The existing `mcp.janejeon.dev` domain is retained outside this partial. Railway
configuration cannot register custom domains, and the project-token CI planner
has reported this existing domain as a new registration. Omitting `domains`
produces no domain deletion in the verified plan and preserves its live binding.

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
The workflow validates and applies the same pinned plan. It permits removal
of Keycloak's two retired bootstrap variables or the exact temporary WhatsApp
trial service/reference pair. The trial pair must occur together and cannot
be mixed with other deletions. Other resource or variable deletions are rejected. Plan contents stay in a
private temporary directory and are not uploaded or printed. Use
`direnv exec . python3 .railway/apply-mcp.py --check-only` to validate locally.
Once each GitHub source is connected, service code deploys from pushes to its
connected branch after GitHub Actions finish successfully. Every owned MCP-stack
source sets `checkSuites: true` (Railway Wait for CI). The infrastructure workflow
also runs the existing backup, transport and query-policy fixtures before its
apply job. Pull requests run the fixtures but never apply production config.
The apply job confirms the config commit without waiting for deployment health,
so it can finish before Railway releases the pending deployment.

Wait for CI evaluates workflow conclusions for the commit, not individual jobs
or checks from other GitHub apps. Failed workflows prevent deployment; skipped
or neutral workflows do not block. Cancellation is not a reliable deploy gate
if another workflow succeeds. Keep required deployment tests uncancelled.
See [Railway GitHub autodeploys](https://docs.railway.com/deployments/github-autodeploys).

When rotating WhatsApp's monitor URL in 1Password, derive `KUMA_PUSH_PATH` from
its path and query and send it through Railway stdin. Keep `HEARTBEAT_URL` as
the reference expression. The full URL in 1Password remains the source for
local backup tests.

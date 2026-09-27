# MCP Railway infrastructure

`railway.ts` owns only the three MCP services and their two volumes through the
named `mcp` partial. It preserves credentials already injected into Railway;
secret values belong in 1Password and never in this file. The existing services
are outside this partial.

Run `railway config plan` from a linked MCP service directory before committing
changes. `.github/workflows/railway-mcp.yml` applies this partial on `git push`
using a project-scoped production token stored in GitHub Actions and 1Password.
The workflow does not allow destructive applies without a separate change.
Once each GitHub source is connected, service code deploys from pushes to its
connected branch.

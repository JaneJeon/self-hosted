# MCP Railway infrastructure

`railway.ts` owns only the three MCP services and their two volumes through the
named `mcp` partial. It preserves credentials already injected into Railway;
secret values belong in 1Password and never in this file. The existing services
are outside this partial.

Run `railway config plan` from a linked MCP service directory before applying
changes. The three GitHub sources are added to this file at cutover. Once each
source is connected, subsequent deployments follow the connected branch on
`git push`.

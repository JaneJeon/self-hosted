# eBay MCP

This private Railway backend runs the official
[eBay API MCP](https://github.com/eBay/npm-public-api-mcp), pinned to package
`1.1.0`, source commit `124d5535fd5b8d8b089081e533343d2212557013`.
The public endpoint is `https://mcp.janejeon.dev/ebay`, protected by the existing
Keycloak Jane identity through agentgateway.

## Credentials and scope

The server uses production application tokens for public marketplace reads.
It needs two runtime secrets:

| Variable             | 1Password source                         |
| -------------------- | ---------------------------------------- |
| `EBAY_CLIENT_ID`     | `op://Self Hosting/eBay API MCP/App ID`  |
| `EBAY_CLIENT_SECRET` | `op://Self Hosting/eBay API MCP/Cert ID` |

The supplied Dev ID is not used by this upstream REST implementation. No eBay
user refresh token or seller-account grant is required for listing search and
details. Production mode permits GET operations only. Application tokens use
the base `https://api.ebay.com/oauth/api_scope` scope.

Resolve local references with `swarp secrets refresh`, then use
`direnv exec services/ebay-mcp <command>`. Inject Railway secrets through stdin,
never arguments or build variables. A new service waits without opening its
listener until credentials are supplied. Missing credentials require a new
deployment after variable injection. Surrounding whitespace is rejected.

## Runtime and deployment

The pinned `mcp-proxy` adapter (`6.7.19`) holds the official stdio process and
serves Streamable HTTP on private port 8080 at `/mcp`. `/ping` checks adapter
availability. A real tool call is required to prove eBay access.

The process runs as the Node image's non-root user. Tokens stay in memory and
refresh automatically. There is no volume, token file, or public backend domain.
Leave `LOG_FILE_PATH` and `EBAY_API_DOC_URL_FILE` unset to retain the default
two-tool interface without file logging. The upstream initialization version
string is `1.0.0`; the package/source pin above identifies the deployed code.

The checked build patch fixes upstream path substitution: both `{item_id}` and
`%7Bitem_id%7D` accept `urlVariables`. Without it, the documented raw form sends
a literal placeholder and eBay reports that the item does not exist.

`.railway/railway.ts` owns the service and the gateway reference. Deploy through
Git push with hooks enabled. The source follows master and waits for CI.
Agentgateway strips the user's Authorization header before forwarding and uses
stateless transport so backend rollouts do not leave a cached dead session.

## Listing search and details

`query_ebay_api` discovers eBay API specifications. `call_ebay_api` invokes their
operations. Both depend on eBay's MCP discovery API in addition to the target
marketplace API. Discovery can return a large specification; request a narrow
operation and keep listing result limits small.

For keyword search, call `call_ebay_api` with:

```json
{
  "url": "https://api.ebay.com/buy/browse/v1/item_summary/search",
  "method": "GET",
  "specTitle": "Browse API",
  "operationId": "search",
  "urlQueryParams": { "q": "Sony WH-1000XM5", "limit": "3" },
  "headers": { "X-EBAY-C-MARKETPLACE-ID": ["EBAY_US"] }
}
```

For details, use `/buy/browse/v1/item/{item_id}`, `operationId: "getItem"`, and
`urlVariables: {"item_id": "<returned itemId>"}` with the same method, spec title,
and marketplace header. Return the title, price value/currency, condition and
listing URL. Preserve shipping costs and auction/current-bid distinctions from
the response when comparing prices.

## Verification

Build and run before pushing:

```sh
docker build -t ebay-mcp:test services/ebay-mcp
EBAY_MCP_TEST_IMAGE=ebay-mcp:test python3 services/ebay-mcp/tests/test-container.py
```

The container suite checks placeholder encoding, startup gating, whitespace
rejection and enforced production application mode without real credentials.
Before release, also prove official-tool discovery, real listing search and
details, gateway rejection policies, and a backend restart through the same
gateway session. Verify real reads in each requested native client.

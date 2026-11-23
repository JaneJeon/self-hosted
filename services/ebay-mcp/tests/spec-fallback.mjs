import assert from 'node:assert/strict'
import axios from '/app/node_modules/axios/index.js'
import yaml from '/app/node_modules/js-yaml/index.js'
import { registerOpenApiTools } from '/app/dist/service/openapi-service.js'

process.env.EBAY_CLIENT_ID = 'synthetic-client'
process.env.EBAY_CLIENT_SECRET = 'synthetic-secret'
process.env.EBAY_TOKEN_TYPE = 'application'
process.env.EBAY_API_ENV = 'production'

const tools = new Map()
await registerOpenApiTools({
  registerTool(name, schema, handler) {
    tools.set(name, { schema, handler })
  },
  registerPrompt() {}
})
assert(tools.has('query_ebay_api'))
assert(tools.has('call_ebay_api'))
const invoke = tools.get('call_ebay_api').handler
const browse = {
  openapi: '3.0.0',
  info: { title: 'Browse API', version: '1' },
  servers: [{ url: 'https://api.ebay.com/buy/browse/v1' }],
  paths: {
    '/item_summary/search': {
      get: {
        operationId: 'search',
        parameters: [
          { in: 'query', name: 'q', required: true, schema: { type: 'string' } }
        ],
        responses: { 200: { description: 'ok' } }
      }
    }
  }
}
const taxonomy = {
  openapi: '3.0.0',
  info: { title: 'Taxonomy API', version: '1' },
  servers: [{ url: 'https://api.ebay.com/commerce/taxonomy/v1' }],
  paths: {
    '/category_tree/{category_tree_id}': {
      get: {
        operationId: 'getCategoryTree',
        parameters: [
          {
            in: 'path',
            name: 'category_tree_id',
            required: true,
            schema: { type: 'string' }
          }
        ],
        responses: { 200: { description: 'ok' } }
      }
    }
  }
}
const browseInput = {
  specTitle: 'browse api',
  operationId: 'search',
  method: 'GET',
  url: 'https://api.ebay.com/buy/browse/v1/item_summary/search',
  urlQueryParams: { q: 'watch' }
}
const taxonomyInput = {
  specTitle: 'Taxonomy API',
  operationId: 'getCategoryTree',
  method: 'GET',
  url: 'https://api.ebay.com/commerce/taxonomy/v1/category_tree/{category_tree_id}',
  urlVariables: { category_tree_id: '0' }
}
let fieldStatus = 404
let candidates = []
let targetResponse = { price: 12 }
let targetError = null
let promptStatus = 200
let calls = []
let grants = 0
axios.post = async url => {
  assert.equal(url, 'https://api.ebay.com/identity/v1/oauth2/token')
  grants++
  return { data: { access_token: 'synthetic-token', expires_in: 7200 } }
}
function failure(status, data, config) {
  return new axios.AxiosError(
    `HTTP ${status}`,
    'ERR_BAD_RESPONSE',
    config,
    {},
    { status, statusText: 'error', data, headers: {}, config }
  )
}
axios.request = async config => {
  calls.push(config)
  const url = new URL(config.url)
  if (url.pathname.startsWith('/developer/mcp/v1/search/')) {
    if (fieldStatus !== 200)
      throw failure(fieldStatus, { error: 'field lookup failed' }, config)
    return { status: 200, data: JSON.stringify(browse) }
  }
  if (url.pathname === '/developer/mcp/v1/search') {
    assert.equal(config.method.toUpperCase(), 'GET')
    assert(url.searchParams.get('query'))
    if (promptStatus !== 200)
      throw failure(promptStatus, { error: 'prompt lookup failed' }, config)
    return { status: 200, data: candidates }
  }
  if (targetError) throw failure(429, targetError, config)
  return { status: 200, data: targetResponse }
}
const targetCalls = () =>
  calls.filter(c => !new URL(c.url).pathname.startsWith('/developer/mcp/'))
const fallbackCalls = () =>
  calls.filter(c => new URL(c.url).pathname === '/developer/mcp/v1/search')
const text = result => result.content.map(c => c.text).join('\n')
async function run(input) {
  calls = []
  return invoke(input, {})
}

fieldStatus = 200
let result = await run(browseInput)
assert(!result.isError, text(result))
assert.equal(fallbackCalls().length, 0)
assert.equal(targetCalls().length, 1)
assert.equal(grants, 1)

fieldStatus = 404
candidates = [yaml.dump(browse)]
result = await run(browseInput)
assert(!result.isError, text(result))
assert.equal(fallbackCalls().length, 1)
assert.equal(
  new URL(fallbackCalls()[0].url).searchParams.get('query'),
  'browse api search'
)
assert.equal(targetCalls().length, 1)
assert.match(text(result), /12/)
targetResponse = { price: 19 }
result = await run(browseInput)
assert(!result.isError, text(result))
assert.match(text(result), /19/)
assert.equal(targetCalls().length, 1)

candidates = [JSON.stringify(taxonomy)]
result = await run(taxonomyInput)
assert(!result.isError, text(result))
assert.equal(targetCalls().length, 1)
assert.equal(
  new URL(targetCalls()[0].url).pathname,
  '/commerce/taxonomy/v1/category_tree/0'
)
for (const placeholder of ['{category_tree_id}', '%7Bcategory_tree_id%7D']) {
  result = await run({
    ...taxonomyInput,
    url: `https://api.ebay.com/commerce/taxonomy/v1/category_tree/${placeholder}`,
    urlVariables: { category_tree_id: '0/child' }
  })
  assert(!result.isError, text(result))
  assert.equal(targetCalls().length, 1)
  assert.equal(
    new URL(targetCalls()[0].url).pathname,
    '/commerce/taxonomy/v1/category_tree/0%2Fchild'
  )
}

const overlapping = structuredClone(taxonomy)
overlapping.paths['/category_tree/root'] = {
  get: { operationId: 'getRoot', responses: { 200: { description: 'ok' } } }
}
candidates = [JSON.stringify(overlapping)]
const concrete = {
  ...taxonomyInput,
  url: 'https://api.ebay.com/commerce/taxonomy/v1/category_tree/root',
  urlVariables: undefined
}
result = await run(concrete)
assert(result.isError, text(result))
assert.equal(targetCalls().length, 0)
result = await run({ ...concrete, operationId: 'getRoot' })
assert(!result.isError, text(result))
assert.equal(targetCalls().length, 1)

const referenced = structuredClone(browse)
referenced.components = {
  parameters: {
    Query: {
      in: 'query',
      name: 'q',
      required: true,
      schema: { type: 'string' }
    }
  }
}
referenced.paths['/item_summary/search'].parameters = [
  { $ref: '#/components/parameters/Query' }
]
referenced.paths['/item_summary/search'].get.parameters = []
candidates = [JSON.stringify(referenced)]
result = await run(browseInput)
assert(!result.isError, text(result))
assert.equal(targetCalls().length, 1)
result = await run({ ...browseInput, urlQueryParams: {} })
assert(result.isError, text(result))
assert.equal(targetCalls().length, 0)

referenced.paths['/item_summary/search'].parameters = [
  { $ref: 'https://spec.example.invalid/parameter.json' }
]
candidates = [JSON.stringify(referenced)]
result = await run(browseInput)
assert(result.isError, text(result))
assert.equal(targetCalls().length, 0)

for (const malformed of [null, {}, 'not an array']) {
  candidates = malformed
  result = await run(browseInput)
  assert(result.isError, text(result))
  assert.equal(targetCalls().length, 0)
}
promptStatus = 503
result = await run(browseInput)
assert(result.isError, text(result))
assert.equal(targetCalls().length, 0)
promptStatus = 200

for (const badCandidates of [
  [
    JSON.stringify({
      ...browse,
      servers: [{ url: 'https://api.ebay.com/sell/browse/v1' }]
    })
  ],
  [JSON.stringify(browse), yaml.dump(browse)],
  ['not an OpenAPI document'],
  [
    JSON.stringify({
      ...browse,
      info: { ...browse.info, title: 'Different API' }
    })
  ],
  [
    JSON.stringify({
      ...browse,
      paths: { '/item_summary/search': { get: { operationId: 'different' } } }
    })
  ]
]) {
  candidates = badCandidates
  result = await run(browseInput)
  assert(result.isError, text(result))
  assert.equal(targetCalls().length, 0)
}
candidates = [JSON.stringify(browse)]
for (const invalid of [
  { ...browseInput, method: 'POST' },
  { ...browseInput, urlQueryParams: {} },
  {
    ...browseInput,
    url: 'https://api.ebay.com/sell/browse/v1/item_summary/search'
  }
]) {
  result = await run(invalid)
  assert(result.isError, text(result))
  assert.equal(targetCalls().length, 0)
}
targetError = { errors: [{ message: 'synthetic upstream rate limit' }] }
result = await run(browseInput)
assert(result.isError, text(result))
assert.match(text(result), /synthetic upstream rate limit/)
assert.equal(targetCalls().length, 1)
fieldStatus = 500
targetError = null
result = await run(browseInput)
assert(result.isError, text(result))
assert.equal(fallbackCalls().length, 0)
assert.equal(targetCalls().length, 0)
console.log('MCP fallback regression assertions passed')

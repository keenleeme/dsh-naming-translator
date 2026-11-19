// Exercises the Host half with a stub context: route registration, request
// framing, caching, the busy guard, and the camelCase folding of a model gloss.
const { apply, default: plugin } = await import('../index.js')

const routes = []
const effects = []
const calls = []
let glossText = 'order page query'

const ctx = {
  effect(fn, label) {
    const dispose = fn()
    effects.push({ dispose, label })
  },
  get(name) {
    if (name === 'agentDefaultModel') {
      return { currentSelection: () => ({ provider: 'trae', model: 'deepseek-v4.1-flash' }) }
    }
    return undefined
  },
  llm: {
    listProviders: () => [{ id: 'trae', name: 'Trae' }],
    listModels: async () => [{ provider: 'trae', id: 'deepseek-v4.1-flash', name: 'flash' }],
    stream(options) {
      calls.push(options)
      return (async function* generate() {
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: glossText }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: glossText } }
        yield { type: 'usage', usage: { inputTokens: 4, outputTokens: 3 } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  },
  webServer: {
    register(route) {
      routes.push(route)
      return () => {}
    },
  },
}

if (plugin.inject.join(',') !== 'llm,webServer') throw new Error('unexpected inject list')
apply(ctx)

if (routes.length !== 1) throw new Error(`expected one route, got ${routes.length}`)
const route = routes[0]
if (route.kind !== 'exact' || route.path !== '/naming-translator/translate') {
  throw new Error(`unexpected route ${route.kind} ${route.path}`)
}

/** Minimal ServerResponse stand-in capturing status, headers, and body. */
function response() {
  const state = { status: 200, headers: {}, body: '' }
  return {
    state,
    writeHead(status, headers) {
      state.status = status
      state.headers = headers ?? {}
    },
    end(body) {
      if (typeof body === 'string') state.body += body
    },
  }
}

/** Minimal IncomingMessage stand-in: async-iterable body plus headers. */
function request(method, body, headers = {}) {
  const text = body === undefined ? '' : body
  return {
    method,
    headers: { 'x-naming-translator': '1', ...headers },
    async *[Symbol.asyncIterator]() {
      if (text.length > 0) yield Buffer.from(text, 'utf8')
    },
  }
}

let failures = 0
function check(label, condition, detail) {
  if (!condition) failures += 1
  console.log(`${condition ? 'PASS' : 'FAIL'} ${label}${condition ? '' : ` :: ${detail}`}`)
}

async function call(method, body, headers) {
  const res = response()
  await route.handler(request(method, body, headers), res)
  let parsed
  try { parsed = JSON.parse(res.state.body) } catch { parsed = undefined }
  return { status: res.state.status, headers: res.state.headers, parsed, raw: res.state.body }
}

// 1. method guard
let result = await call('GET', undefined)
check('GET is refused', result.status === 405 && result.parsed.code === 'METHOD', result.raw)

// 2. header guard
result = await call('POST', JSON.stringify({ text: '订单' }), { 'x-naming-translator': '' })
check('missing header is refused', result.status === 403 && result.parsed.code === 'HEADER', result.raw)

// 3. bad json
result = await call('POST', 'not json')
check('bad JSON is refused', result.status === 400 && result.parsed.code === 'BAD_JSON', result.raw)

// 4. empty text
result = await call('POST', JSON.stringify({ text: '   ' }))
check('empty text is refused', result.status === 400 && result.parsed.code === 'EMPTY', result.raw)

// 5. over-long text
result = await call('POST', JSON.stringify({ text: '订'.repeat(300) }))
check('over-long text is refused', result.status === 400 && result.parsed.code === 'TOO_LONG', result.raw)

// 6. successful gloss, folded to camelCase
result = await call('POST', JSON.stringify({ text: '订单分页查询' }))
check('model gloss becomes camelCase', result.status === 200 && result.parsed.identifier === 'orderPageQuery', result.raw)
check('route echoes the model route', result.parsed.route.provider === 'trae' && result.parsed.route.model === 'deepseek-v4.1-flash', result.raw)
check('model call carried the system prompt', calls.length === 1 && typeof calls[0].system === 'string' && calls[0].maxTokens === 32, JSON.stringify(calls[0] ?? {}))

// 7. cache hit avoids a second model call
const before = calls.length
result = await call('POST', JSON.stringify({ text: '订单分页查询' }))
check('second identical phrase is cached', result.status === 200 && result.parsed.cached === true && calls.length === before, result.raw)

// 8. a chatty model answer still folds to one identifier
glossText = 'Order Page Query — as used in the order module.\nMore prose here.'
result = await call('POST', JSON.stringify({ text: '订单分页查询二' }))
check('prose answer folds to an identifier', result.status === 200 && result.parsed.identifier === 'orderPageQuery', result.raw)

// 9. an unusable model answer is a diagnosable 502
glossText = '……'
result = await call('POST', JSON.stringify({ text: '订单三' }))
check('no usable words is a 502', result.status === 502 && result.parsed.code === 'NO_GLOSS', result.raw)

// 9b. a model that echoes "no phrase provided" is a refusal, not an identifier
glossText = 'No phrase provided'
result = await call('POST', JSON.stringify({ text: '订单四' }))
check('refusal-only answer is a 502', result.status === 502 && result.parsed.code === 'NO_GLOSS', result.raw)

// 9c. a refusal prefix blocks the answer even when a gloss follows
glossText = 'unknown\n\nActually: coupon redemption'
result = await call('POST', JSON.stringify({ text: '订单五' }))
check('refusal prefix yields no identifier', result.status === 502, result.raw)

// 9d. a gloss followed by prose keeps only the gloss
glossText = 'coupon redemption is the act of using a coupon'
result = await call('POST', JSON.stringify({ text: '订单六' }))
check('trailing prose is dropped', result.status === 200 && result.parsed.identifier === 'couponRedemption', result.raw)

// 10. teardown releases the route and the model-abort effect
for (const { dispose } of effects) if (typeof dispose === 'function') dispose()
check('two effects were registered', effects.length === 2, String(effects.length))

console.log(failures === 0 ? '\nHOST CHECKS PASSED' : `\n${failures} HOST CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)

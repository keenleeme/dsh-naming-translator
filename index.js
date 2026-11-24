/**
 * Naming Translator — Host half.
 *
 * The browser half owns the dictionary, the tokenizer, and the UI. This half
 * owns the one thing a page cannot do: the model fallback for Chinese words the
 * dictionary does not cover. It publishes one small JSON route on the Harness
 * web server and answers it with a single `ctx.llm.stream()` call, so the
 * browser never needs provider credentials and never talks to a provider
 * directly.
 *
 * Deliberate boundaries:
 * - The route is a plain `POST` JSON endpoint under a plugin-owned path. No
 *   Harness package is imported at runtime; the Host row only uses `ctx.llm`,
 *   `ctx.webServer`, and the optional `ctx.agentDefaultModel` seat.
 * - The model is asked for a short English gloss, never for code. The Host
 *   folds the gloss into a valid camelCase identifier itself, so a chatty model
 *   answer cannot leak prose into a variable name.
 * - Every failure is a diagnosable JSON error rather than a 500 with a stack:
 *   the panel shows the reason and keeps the dictionary answer.
 *
 * @module @xpeanut/dsh-naming-translator
 */

/** Package name; also the client module id and the storage namespace prefix. */
const PACKAGE_NAME = '@xpeanut/dsh-naming-translator'

/** Exact web route the browser half calls. Plugin-owned, so no collision. */
const ROUTE_PATH = '/naming-translator/translate'

/** Upper bound on one submitted phrase; longer input is a client-side mistake. */
const MAX_INPUT_CHARS = 240

/** Upper bound on the accepted request body, before JSON parsing. */
const MAX_BODY_BYTES = 8192

/** Answers reused for an identical phrase while the Host runs. */
const CACHE_LIMIT = 128

/** Concurrent model calls allowed; the panel submits one at a time anyway. */
const MAX_INFLIGHT = 2

/**
 * Instruction that keeps the answer a short gloss instead of an explanation.
 * It also rides in the user message: several provider routes drop or reshape a
 * separate system slot, and the phrase alone gives a small model nothing to
 * anchor on.
 */
const SYSTEM_PROMPT = [
  'You name software identifiers.',
  'Reply with the English meaning of the Chinese phrase as one to four lowercase words.',
  'Reply with only those words, separated by single spaces, with no punctuation,',
  'no quotes, no explanation, and no code. Prefer the usual developer vocabulary',
  'for the domain (for example user, order, list, query, config).',
].join(' ')

/** The instruction restated with the phrase, so no route can lose it. */
function userPrompt(phrase) {
  return `${SYSTEM_PROMPT}

Chinese phrase: ${phrase}
English words:`
}

/**
 * Words that never appear inside a gloss: English function words, plus the
 * vocabulary a model uses when it did not read the phrase at all
 * (`no phrase provided`). The gloss ends at the first one, so a model that
 * answers and then explains still contributes the words before that point,
 * while an answer made only of these is a failed call rather than an
 * identifier.
 */
const NON_GLOSS_WORDS = new Set([
  // function words
  'a', 'an', 'and', 'as', 'at', 'because', 'but', 'by', 'for', 'from', 'here',
  'however', 'i', 'in', 'is', 'it', 'its', 'means', 'note', 'of', 'on', 'or',
  'refers', 'so', 'that', 'the', 'then', 'these', 'this', 'to', 'translates',
  'translation', 'use', 'used', 'using', 'which', 'with', 'words', 'would',
  // refusal vocabulary
  'cannot', 'could', 'empty', 'error', 'given', 'input', 'invalid', 'missing',
  'n/a', 'no', 'none', 'not', 'nothing', 'phrase', 'please', 'provided',
  'unable', 'unclear', 'undefined', 'unknown', 'unspecified',
])

/**
 * Split any identifier-ish text into lowercase latin words, so `userInfo`,
 * `user-info`, and `user info` all fold to the same gloss.
 * @param value - free text from a model or a dictionary entry.
 * @returns the latin words in order.
 */
function latinWords(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase())
}

/**
 * Fold words into a camelCase identifier, dropping characters that cannot
 * appear in one.
 * @param words - lowercase latin words.
 * @returns the identifier, or an empty string when nothing usable remains.
 */
function camelCase(words) {
  const cleaned = words
    .map((word) => word.replace(/[^a-z0-9]/gi, ''))
    .filter((word) => word.length > 0)
  if (cleaned.length === 0) return ''
  return cleaned
    .map((word, index) => (index === 0 ? word.toLowerCase() : word[0].toUpperCase() + word.slice(1).toLowerCase()))
    .join('')
}

/**
 * Extract the words a model answer contributes, rejecting an answer that never
 * read the phrase.
 *
 * A small model sometimes echoes the empty-input shape of the instruction
 * (`no phrase provided`) instead of glossing anything. That is a failed call,
 * not an identifier, so an answer whose every word is
 * {@link NON_GLOSS_WORDS} yields nothing and the route reports `NO_GLOSS`.
 * Prose after the gloss is ignored: the words stop at the first function word.
 *
 * @param answer - complete model text.
 * @returns lowercase latin words, empty when the model refused.
 */
function glossWords(answer) {
  const kept = []
  for (const word of latinWords(answer.trim().split('\n')[0])) {
    if (NON_GLOSS_WORDS.has(word)) break
    kept.push(word)
    if (kept.length === 4) break
  }
  return kept
}

/** Answer one request with a JSON body. */
function sendJson(response, status, body) {
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  })
  response.end(payload)
}

/**
 * Read a request body within {@link MAX_BODY_BYTES}.
 * @param request - the incoming request.
 * @returns the body text, or `undefined` when the limit was exceeded.
 */
async function readBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) return undefined
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * List the model routes to try, best first: the profile's default model, then
 * every other provider that advertises at least one model.
 *
 * A list rather than one route because the default model is a user setting that
 * can point at an endpoint which is not running — a local proxy that is down, a
 * typo in a base URL. Trying the configured default first keeps the user's
 * choice authoritative, and the fallbacks keep the panel working when that
 * choice cannot reach anything.
 *
 * @param ctx - Host context.
 * @returns candidate routes in preference order; empty when none is configured.
 */
async function resolveRoutes(ctx) {
  const routes = []
  const seen = new Set()
  const push = (provider, model) => {
    if (typeof provider !== 'string' || provider.length === 0) return
    if (typeof model !== 'string' || model.length === 0) return
    const key = `${provider}\0${model}`
    if (seen.has(key)) return
    seen.add(key)
    routes.push({ provider, model })
  }

  const fallback = ctx.get?.('agentDefaultModel')
  const selection = typeof fallback?.currentSelection === 'function' ? fallback.currentSelection() : undefined
  push(selection?.provider, selection?.model)

  for (const provider of ctx.llm.listProviders()) {
    let models
    try {
      models = await ctx.llm.listModels(provider.id)
    } catch {
      continue
    }
    const first = models.find((model) => typeof model.id === 'string' && model.id.length > 0)
    if (first !== undefined) push(provider.id, first.id)
  }
  return routes
}

/**
 * Explain one route's failure in terms a developer can act on.
 *
 * `TRANSPORT` is the important case: the provider endpoint did not answer at
 * all, which in practice means a local proxy that is not running. The bare code
 * tells a user nothing, so the hint names what to check.
 *
 * @param code - provider-neutral failure code from the LLM service.
 * @returns a sentence appended to that route's entry in the error report.
 */
function failureHint(code) {
  switch (code) {
    case 'TRANSPORT':
      return 'endpoint not reachable; check that the provider is running'
    case 'NO_ADAPTER':
      return 'no adapter owns this provider'
    case 'MISSING_CREDENTIAL':
    case 'INVALID_CREDENTIAL':
      return 'missing or invalid credential'
    case 'NO_GLOSS':
      return 'the model did not answer with English words'
    default:
      return ''
  }
}

/**
 * Stream one gloss for `phrase` through the Harness LLM service.
 * @param ctx - Host context.
 * @param phrase - the Chinese phrase to gloss.
 * @param signal - cancellation for this call.
 * @returns the route used and the assembled answer text.
 */
async function gloss(ctx, phrase, signal) {
  const routes = await resolveRoutes(ctx)
  if (routes.length === 0) {
    throw Object.assign(new Error('No model route is configured for the naming translator'), { code: 'NO_MODEL' })
  }

  const failures = []
  for (const route of routes) {
    signal.throwIfAborted()
    const chunks = []
    let answer = ''
    try {
      const stream = ctx.llm.stream({
        provider: route.provider,
        model: route.model,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: [{ type: 'text', text: userPrompt(phrase) }] }],
        temperature: 0,
        maxTokens: 32,
        signal,
      })
      for await (const chunk of stream) {
        if (chunk.type === 'text-delta') answer += chunk.text
        else if (chunk.type === 'finish' && chunk.reason.kind === 'error') {
          throw Object.assign(new Error(chunk.reason.failure.message), { code: chunk.reason.failure.code })
        } else if (chunk.type === 'finish' && chunk.reason.kind === 'aborted') {
          throw Object.assign(new Error('The model call was interrupted'), { code: 'ABORTED' })
        } else if (chunk.type === 'block-end' && chunk.block.type === 'text') {
          chunks.push(chunk.block.text)
        }
      }
      const text = answer.length > 0 ? answer : chunks.join(' ')
      // An answer with no usable words is a failure of this route, not a
      // success: trying the next one is cheaper than asking the user to retry.
      if (glossWords(text).length === 0) {
        failures.push({ route, code: 'NO_GLOSS', message: 'the model returned no usable English words' })
        continue
      }
      return { route, answer: text }
    } catch (error) {
      if (signal.aborted) throw error
      failures.push({
        route,
        code: typeof error?.code === 'string' ? error.code : 'MODEL_FAILED',
        message: typeof error?.message === 'string' ? error.message : 'the model call failed',
      })
      // An abort is the caller's, not a reason to try another route.
      if (error?.code === 'ABORTED') throw error
    }
  }

  // Every route failed. Report the first failure, but name every route tried so
  // a misconfigured default is visible rather than silently masked.
  const described = failures.map((failure) => {
    const hint = failureHint(failure.code)
    const suffix = hint.length > 0 ? ` ${hint}` : ` ${failure.message}`
    return `${failure.route.provider}/${failure.route.model} -> ${failure.code}:${suffix}`
  })
  const chosen = failures[0]
  throw Object.assign(
    new Error(`No model route answered the naming translator. Tried: ${described.join('; ')}.`),
    { code: chosen !== undefined ? chosen.code : 'MODEL_FAILED' },
  )
}

/**
 * Mount the model-fallback route.
 * @param ctx - Host context; `llm` and `webServer` are required.
 */
export function apply(ctx) {
  /** Answers already produced for an identical phrase. */
  const cache = new Map()
  /** In-flight calls, so a held Enter key cannot fan out into many requests. */
  let inflight = 0
  const lifetime = new AbortController()
  ctx.effect(() => () => { lifetime.abort() }, 'naming-translator: model calls')

  /**
   * Answer one translation request.
   * @param request - the incoming HTTP request.
   * @param response - the response the route owns.
   */
  async function handler(request, response) {
    if (request.method !== 'POST') {
      response.writeHead(405, { allow: 'POST', 'content-type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ ok: false, code: 'METHOD', message: 'POST only' }))
      return
    }
    // A custom header keeps a cross-site form post from reaching the model.
    if (request.headers['x-naming-translator'] !== '1') {
      sendJson(response, 403, { ok: false, code: 'HEADER', message: 'Missing x-naming-translator header' })
      return
    }
    const body = await readBody(request)
    if (body === undefined) {
      sendJson(response, 413, { ok: false, code: 'TOO_LARGE', message: 'Request body is too large' })
      return
    }
    let phrase
    try {
      const parsed = JSON.parse(body)
      phrase = typeof parsed?.text === 'string' ? parsed.text.trim() : ''
    } catch {
      sendJson(response, 400, { ok: false, code: 'BAD_JSON', message: 'Body must be JSON' })
      return
    }
    if (phrase.length === 0) {
      sendJson(response, 400, { ok: false, code: 'EMPTY', message: 'Text is empty' })
      return
    }
    if (phrase.length > MAX_INPUT_CHARS) {
      sendJson(response, 400, { ok: false, code: 'TOO_LONG', message: `Text exceeds ${MAX_INPUT_CHARS} characters` })
      return
    }
    const cached = cache.get(phrase)
    if (cached !== undefined) {
      sendJson(response, 200, { ok: true, source: 'model', cached: true, ...cached })
      return
    }
    if (inflight >= MAX_INFLIGHT) {
      sendJson(response, 429, { ok: false, code: 'BUSY', message: 'Another translation is still running' })
      return
    }
    inflight += 1
    try {
      const { route, answer } = await gloss(ctx, phrase, lifetime.signal)
      const words = glossWords(answer)
      const identifier = camelCase(words)
      if (identifier.length === 0) {
        const refusal = Object.assign(
          new Error('The model did not answer with English words'),
          { code: 'NO_GLOSS', answer },
        )
        throw refusal
      }
      const value = { identifier, words, route }
      cache.set(phrase, value)
      if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value)
      sendJson(response, 200, { ok: true, source: 'model', cached: false, ...value })
    } catch (error) {
      if (lifetime.signal.aborted) return
      // The gloss() call already names every route it tried; keep its message.
      sendJson(response, 502, {
        ok: false,
        code: typeof error?.code === 'string' ? error.code : 'MODEL_FAILED',
        message: typeof error?.message === 'string' ? error.message : 'The model call failed',
        ...(typeof error?.answer === 'string' ? { answer: error.answer.slice(0, 200) } : {}),
      })
    } finally {
      inflight -= 1
    }
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE_PATH,
    handler,
  }), 'naming-translator: translate route')
}

export default { name: PACKAGE_NAME, inject: ['llm', 'webServer'], apply }

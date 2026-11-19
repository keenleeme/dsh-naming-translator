// Audit every seed term through the real tokenizer: each key must resolve on
// its own to the value it declares, and no seed may leave unknown characters.
const fs = require('node:fs')
const path = require('node:path')

const registrations = []
globalThis.window = { __ModuleLoader__: { load: (registration) => registrations.push(registration) } }
const fakeReact = {
  createElement: () => null,
  useState: (v) => [v, () => {}],
  useEffect: () => {},
  useRef: () => ({ current: null }),
  useCallback: (fn) => fn,
}
const fakeRequire = (name) => {
  if (name === 'react') return fakeReact
  if (name === 'react-dom') return { createPortal: () => null }
  throw new Error(`unexpected require: ${name}`)
}
// eslint-disable-next-line no-new-func
new Function('window', fs.readFileSync(path.join(__dirname, '..', 'client.js'), 'utf8'))(globalThis.window)
const bundle = registrations[0].factory(fakeRequire)

const SEEDS = bundle.SEED_GLOSSARY
let failures = 0
function check(label, condition, detail) {
  if (!condition) failures += 1
  console.log(`${condition ? 'PASS' : 'FAIL'} ${label}${condition ? '' : ` :: ${detail}`}`)
}

// 1. Each seed key alone must produce a non-empty identifier with no unknowns.
//    Several keys are single characters that the built-in dictionary also
//    covers; those are checked for resolution, not for word identity.
const unresolved = []
for (const [key, value] of Object.entries(SEEDS)) {
  const result = bundle.translateLocally(key, SEEDS)
  if (result.unknown.length > 0 || result.identifier.length === 0) {
    unresolved.push(`${key} -> "${result.identifier}" unknown=[${result.unknown.join('')}]`)
  }
}
check('every seed term resolves on its own', unresolved.length === 0, unresolved.join(' | '))

// 2. A seed key must segment as itself, not as smaller built-in pieces, when
//    the key is longer than anything built-in that could cover it.
const shadowed = []
for (const key of Object.keys(SEEDS)) {
  const result = bundle.translateLocally(key, SEEDS)
  const expected = bundle.camelCase(SEEDS[key].split(/\s+/))
  if (result.identifier !== expected && bundle.DICT[key] === undefined && key.length > 1) {
    // Multi-word keys may legitimately segment because the DP prefers more
    // coverage; only flag the case where the seed lost to a longer built-in.
    shadowed.push(`${key}: got ${result.identifier}, seed says ${expected}`)
  }
}
check('no seed loses to a built-in segmentation', shadowed.length === 0, shadowed.slice(0, 6).join(' | '))

// 3. A seed must not turn a previously unknown phrase into a partial answer
//    that hides remaining unknowns: unknown reporting must survive.
const partial = bundle.translateLocally('门店噼里啪', SEEDS)
check('unknown characters still surface next to a seed hit',
  partial.unknown.length === 3 && partial.words.includes('store'),
  `${partial.identifier} unknown=[${partial.unknown.join('')}]`)

// 4. Seeded phrases compose with built-in words.
const composed = [
  ['门店列表', 'storeList'],
  ['渠道配置', 'channelConfig'],
  ['用户画像查询', 'userProfileQuery'],
  ['熔断阈值', 'circuitBreakerThreshold'],
]
for (const [phrase, expected] of composed) {
  const result = bundle.translateLocally(phrase, SEEDS)
  check(`${phrase} composes through the seed`, result.identifier === expected && result.unknown.length === 0,
    `${result.identifier} unknown=[${result.unknown.join('')}]`)
}

// 5. Without the glossary those same phrases fall back to the model. This is
//    the whole point of the seed: it removes the round trip.
const withoutSeed = bundle.translateLocally('门店列表', {})
check('an unseeded glossary leaves the phrase for the model',
  withoutSeed.unknown.length > 0,
  `${withoutSeed.identifier} unknown=[${withoutSeed.unknown.join('')}]`)

console.log(`\nseed terms checked = ${Object.keys(SEEDS).length}`)
console.log(failures === 0 ? 'SEED AUDIT PASSED' : `SEED AUDIT: ${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)

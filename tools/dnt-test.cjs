// Loads the browser bundle with a stubbed module loader and exercises the
// dictionary/tokenizer/camelCase path without a browser.
const fs = require('node:fs')
const path = require('node:path')

const registrations = []
globalThis.window = {
  __ModuleLoader__: {
    load(registration) {
      registrations.push(registration)
    },
  },
}
const fakeReact = {
  createElement: (...args) => ({ args }),
  useState: () => [undefined, () => {}],
  useEffect: () => {},
  useRef: () => ({ current: null }),
  useCallback: (fn) => fn,
}
const fakeRequire = (name) => {
  if (name === 'react') return fakeReact
  if (name === 'react-dom') return { createPortal: () => null }
  throw new Error(`unexpected require: ${name}`)
}

const file = path.join(__dirname, '..', 'client.js')
const source = fs.readFileSync(file, 'utf8')
// eslint-disable-next-line no-new-func
new Function('window', source)(globalThis.window)

if (registrations.length !== 1) throw new Error(`expected 1 registration, got ${registrations.length}`)
const bundle = registrations[0].factory(fakeRequire)

const cases = [
  ['用户信息', 'userInfo'],
  ['订单列表', 'orderList'],
  ['订单分页查询', 'orderPageQuery'],
  ['创建时间', 'createTime'],
  ['用户名称', 'userName'],
  ['更新用户信息', 'updateUserInfo'],
  ['删除订单', 'deleteOrder'],
  ['商品价格', 'productPrice'],
  ['支付状态', 'payStatus'],
  ['登录失败原因', 'loginFailReason'],
  ['获取用户列表', 'getUserList'],
  ['库存数量', 'stockCount'],
  ['购物车', 'cart'],
  ['购物', 'shopping'],
  ['getUserList', 'getUserList'],
  ['user_info', 'userInfo'],
  ['用户信息（最新）', 'userInfoLatest'],
]

let failures = 0
for (const [input, expected] of cases) {
  const result = bundle.translateLocally(input, {})
  const ok = result.identifier === expected && result.unknown.length === 0
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${input} -> ${result.identifier || '(none)'} unknown=[${result.unknown.join('')}]${ok ? '' : ` expected=${expected}`}`)
}

// glossary override
const overridden = bundle.translateLocally('门店渠道', { 门店: 'store', 渠道: 'channel' })
console.log(`${overridden.identifier === 'storeChannel' ? 'PASS' : 'FAIL'} glossary override -> ${overridden.identifier}`)
if (overridden.identifier !== 'storeChannel') failures += 1

// unknown detection drives the model fallback
const unknown = bundle.translateLocally('噼里啪啦', {})
console.log(`${unknown.unknown.length === 4 ? 'PASS' : 'FAIL'} unknown detection -> unknown=[${unknown.unknown.join('')}] id="${unknown.identifier}"`)
if (unknown.unknown.length !== 4) failures += 1

// glossary text parsing
const parsed = bundle.parseGlossaryText('# comment\n门店=store\n渠道:channel\nbad line\n\n')
const parsedOk = Object.keys(parsed).length === 2 && parsed['门店'] === 'store' && parsed['渠道'] === 'channel'
console.log(`${parsedOk ? 'PASS' : 'FAIL'} glossary parse -> ${JSON.stringify(parsed)}`)
if (!parsedOk) failures += 1

// ── seed glossary ─────────────────────────────────────────────────────────
const SEEDS = bundle.SEED_GLOSSARY
const seedKeys = Object.keys(SEEDS)
function expect(label, condition, detail) {
  if (!condition) failures += 1
  console.log(`${condition ? 'PASS' : 'FAIL'} ${label}${condition ? '' : ` :: ${detail}`}`)
}

expect('seed glossary is populated', seedKeys.length >= 100, String(seedKeys.length))
expect('every seed value is lowercase latin words',
  seedKeys.every((key) => /^[a-z0-9]+( [a-z0-9]+)*$/.test(SEEDS[key])),
  seedKeys.filter((key) => !/^[a-z0-9]+( [a-z0-9]+)*$/.test(SEEDS[key])).map((k) => `${k}=${SEEDS[k]}`).join(' | '))
expect('no seed key shadows a built-in entry',
  seedKeys.every((key) => bundle.DICT[key] === undefined),
  seedKeys.filter((key) => bundle.DICT[key] !== undefined).join(' '))
expect('no duplicate seed keys', new Set(seedKeys).size === seedKeys.length, String(seedKeys.length))

// A seeded term must actually resolve now that the glossary covers it.
for (const [phrase, expected] of [
  ['门店渠道', 'storeChannel'],
  ['优惠券核销', 'couponRedeem'],
  ['网关限流', 'gatewayRateLimit'],
  ['用户画像', 'userProfile'],
  ['幂等键', 'idempotentKey'],
]) {
  const result = bundle.translateLocally(phrase, SEEDS)
  expect(`${phrase} resolves through the seed glossary`,
    result.identifier === expected && result.unknown.length === 0,
    `${result.identifier} unknown=[${result.unknown.join('')}]`)
}

// Order-independence of the seed: it must not change a purely built-in phrase.
for (const [phrase, expected] of [
  ['用户信息', 'userInfo'],
  ['订单分页查询', 'orderPageQuery'],
  ['购物车', 'cart'],
]) {
  const result = bundle.translateLocally(phrase, SEEDS)
  expect(`${phrase} is unchanged by the seed`, result.identifier === expected, result.identifier)
}

// ── seeding lifecycle ─────────────────────────────────────────────────────
function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    keys: () => [...map.keys()],
    size: () => map.size,
  }
}

// First run: an empty store receives the seed and the flag.
const fresh = fakeStorage()
const firstRun = bundle.loadGlossary(fresh)
expect('first run installs the seed', Object.keys(firstRun).length === seedKeys.length, String(Object.keys(firstRun).length))
expect('first run records the seeded flag', fresh.keys().includes('dsh-naming-translator/seeded'), fresh.keys().join(','))
expect('first run persists the seed', fresh.getItem('dsh-naming-translator/glossary') !== null, 'nothing stored')

// Second run: the stored copy is returned unchanged, and no reseed happens
// after the developer deletes an entry.
const edited = { ...firstRun }
delete edited['门店']
fresh.setItem('dsh-naming-translator/glossary', JSON.stringify({ version: 1, entries: edited }))
const secondRun = bundle.loadGlossary(fresh)
expect('second run honors the edited glossary', secondRun['门店'] === undefined && secondRun['渠道'] === 'channel',
  JSON.stringify({ store: secondRun['门店'], channel: secondRun['渠道'] }))

// An emptied glossary stays empty once seeded.
fresh.setItem('dsh-naming-translator/glossary', JSON.stringify({ version: 1, entries: {} }))
const afterClear = bundle.loadGlossary(fresh)
expect('a seeded browser is never reseeded after clearing', Object.keys(afterClear).length === 0,
  String(Object.keys(afterClear).length))

// A stored glossary from before seeding is preserved and merged under the seed.
const legacy = fakeStorage({ 'dsh-naming-translator/glossary': JSON.stringify({ version: 1, entries: { 门店: 'shop' } }) })
const merged = bundle.loadGlossary(legacy)
expect('an existing entry wins over the seed', merged['门店'] === 'shop', String(merged['门店']))
expect('the seed still fills the rest', merged['渠道'] === 'channel', String(merged['渠道']))

console.log(`dictionary size = ${Object.keys(bundle.DICT).length}, seed size = ${seedKeys.length}`)
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)

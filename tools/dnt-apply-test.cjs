// Exercises the client plugin body: locale registration, style injection, and
// the single slot registration, including teardown.
const fs = require('node:fs')
const path = require('node:path')

const registrations = []
const styleNodes = []
globalThis.window = {
  __ModuleLoader__: { load: (registration) => registrations.push(registration) },
  innerWidth: 1440,
  innerHeight: 900,
  setTimeout: (fn) => setTimeout(fn, 0),
  clearTimeout: (handle) => clearTimeout(handle),
  addEventListener() {},
  removeEventListener() {},
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
}
globalThis.document = {
  head: { appendChild: (node) => styleNodes.push(node) },
  body: {},
  addEventListener() {},
  removeEventListener() {},
  querySelector: () => null,
  createElement(tag) {
    return { tagName: tag, dataset: {}, textContent: '', remove() { this.removed = true } }
  },
}
globalThis.navigator = { clipboard: { writeText: async () => {} } }

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

const file = path.join(__dirname, '..', 'client.js')
new Function('window', fs.readFileSync(file, 'utf8'))(globalThis.window)
const bundle = registrations[0].factory(fakeRequire)
const registration = registrations[0]

let failures = 0
function check(label, condition, detail) {
  if (!condition) failures += 1
  console.log(`${condition ? 'PASS' : 'FAIL'} ${label}${condition ? '' : ` :: ${detail}`}`)
}

check('bundle registers under the package name', registration.id === 'dsh-naming-translator', registration.id)
check('inject names slots and locale', bundle.inject.join(',') === 'slots,locale', bundle.inject.join(','))

const registeredDictionaries = []
const registeredSlots = []
const effects = []
const ctx = {
  effect(fn, label) {
    const dispose = fn()
    effects.push({ dispose, label })
  },
  locale: {
    register(namespace, dictionaries) {
      registeredDictionaries.push({ namespace, dictionaries })
      return () => {}
    },
  },
  slots: {
    inject(slotName, callback) {
      check('slots.inject targets the composer tool row', slotName === 'conversation.input.left', slotName)
      const dispose = callback()
      return dispose
    },
    register(options, component) {
      registeredSlots.push({ options, component })
      return () => {}
    },
  },
}

bundle.apply(ctx)

check('locale namespace is registered', registeredDictionaries.length === 1 && registeredDictionaries[0].namespace === 'naming-translator', JSON.stringify(registeredDictionaries.map((d) => d.namespace)))
const dictionaries = registeredDictionaries[0].dictionaries
check('both baseline locales are registered', dictionaries.zh !== undefined && dictionaries.en !== undefined, Object.keys(dictionaries).join(','))
const zhKeys = Object.keys(dictionaries.zh)
const enKeys = Object.keys(dictionaries.en)
check('zh and en carry identical key sets', zhKeys.length === enKeys.length && zhKeys.every((key) => key === undefined || enKeys.includes(key)), `zh=${zhKeys.length} en=${enKeys.length}`)
check('every rendered key is translated', zhKeys.every((key) => typeof dictionaries.zh[key] === 'string' && dictionaries.zh[key].length > 0), 'empty value')

check('one style element was appended', styleNodes.length === 1, String(styleNodes.length))
check('style is tagged with the package name', styleNodes[0].dataset.plugin === 'dsh-naming-translator', JSON.stringify(styleNodes[0].dataset))
check('style declares the CSS resource', styleNodes[0].dataset.pluginCss === 'dsh-naming-translator/client.css', JSON.stringify(styleNodes[0].dataset))
check('style text is scoped', styleNodes[0].textContent.includes('[data-naming-translator]'), 'unscoped css')

check('exactly one slot is registered', registeredSlots.length === 1, String(registeredSlots.length))
const slot = registeredSlots[0]
check('slot name is the tool row', slot.options.name === 'conversation.input.left', slot.options.name)
check('slot id is plugin-owned', slot.options.id === 'naming-translator', slot.options.id)
check('slot declares its locale namespace', slot.options.locale === 'naming-translator', String(slot.options.locale))
check('slot order is a number', typeof slot.options.order === 'number', String(slot.options.order))
check('slot component is the translator', slot.component === bundle.NamingTranslator, String(slot.component?.name))

// Teardown: both effects must dispose without throwing, removing the style.
for (const { dispose } of effects) if (typeof dispose === 'function') dispose()
check('style was removed on teardown', styleNodes[0].removed === true, 'style still attached')
check('two effects own the plugin', effects.length === 2, String(effects.length))

console.log(failures === 0 ? '\nCLIENT PLUGIN CHECKS PASSED' : `\n${failures} CLIENT PLUGIN CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)

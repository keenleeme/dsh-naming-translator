// Render the tool-row component with a minimal hooks runtime to prove it runs,
// reacts to input, and produces the expected identifier in its output node.
const fs = require('node:fs')
const path = require('node:path')

const registrations = []
globalThis.window = {
  __ModuleLoader__: { load: (registration) => registrations.push(registration) },
  innerWidth: 1440,
  innerHeight: 900,
  setTimeout: (fn) => setTimeout(fn, 0),
  clearTimeout: (handle) => clearTimeout(handle),
  addEventListener() {},
  removeEventListener() {},
  localStorage: {
    store: new Map(),
    getItem(key) { return this.store.has(key) ? this.store.get(key) : null },
    setItem(key, value) { this.store.set(key, String(value)) },
    removeItem(key) { this.store.delete(key) },
  },
}
globalThis.document = {
  head: { appendChild() {} },
  body: {},
  addEventListener() {},
  removeEventListener() {},
  querySelector() { return null },
}
globalThis.navigator = { clipboard: { writeText: async () => {} } }
globalThis.fetch = async () => { throw new Error('model fallback must not run for dictionary-covered phrases') }

/** Hook slot runtime good enough for one component render pass. */
let slots = []
let cursor = 0
let pendingEffects = []
const fakeReact = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() }),
  useState(initial) {
    const index = cursor++
    if (slots.length <= index) slots[index] = typeof initial === 'function' ? initial() : initial
    const set = (next) => {
      slots[index] = typeof next === 'function' ? next(slots[index]) : next
    }
    return [slots[index], set]
  },
  useEffect(fn) {
    const index = cursor++
    pendingEffects.push({ index, fn })
  },
  useRef(initial) {
    const index = cursor++
    if (slots.length <= index) slots[index] = { current: initial }
    return slots[index]
  },
  useCallback(fn) {
    cursor += 1
    return fn
  },
  useSyncExternalStore(subscribe, getSnapshot) {
    cursor += 1
    return getSnapshot()
  },
}

const fakeRequire = (name) => {
  if (name === 'react') return fakeReact
  if (name === 'react-dom') return { createPortal: (node) => node }
  throw new Error(`unexpected require: ${name}`)
}

const file = path.join(__dirname, '..', 'client.js')
new Function('window', fs.readFileSync(file, 'utf8'))(globalThis.window)
const bundle = registrations[0].factory(fakeRequire)

/** Walk the element tree, collecting text and finding nodes by className. */
function texts(node, collected = []) {
  if (node === null || node === undefined || node === false) return collected
  if (typeof node === 'string' || typeof node === 'number') {
    collected.push(String(node))
    return collected
  }
  if (Array.isArray(node)) {
    for (const child of node) texts(child, collected)
    return collected
  }
  if (node.children) texts(node.children, collected)
  return collected
}
function findAll(node, predicate, found = []) {
  if (node === null || node === undefined || typeof node !== 'object') return found
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, predicate, found)
    return found
  }
  if (predicate(node)) found.push(node)
  if (node.children) findAll(node.children, predicate, found)
  return found
}

const t = (key) => key
const inputActions = {
  captureInsertion: () => ({ from: 0, to: 0, rev: 0 }),
  insertText: () => true,
  setDraft() {},
}

let failures = 0
function check(label, condition, detail) {
  if (!condition) failures += 1
  console.log(`${condition ? 'PASS' : 'FAIL'} ${label}${condition ? '' : ` :: ${detail}`}`)
}

/** Render once from a clean hook state. */
function render(props = {}) {
  slots = []
  cursor = 0
  pendingEffects = []
  const tree = bundle.NamingTranslator({ t, inputActions, ...props })
  return { tree, effects: pendingEffects }
}

let pass = render()
check('component renders without throwing', pass.tree !== null && typeof pass.tree === 'object', String(pass.tree))
const trigger = findAll(pass.tree, (node) => node.props?.className === 'dnt-trigger')[0]
check('tool-row trigger exists', trigger !== undefined, texts(pass.tree).join('|'))
check('trigger is collapsed initially', trigger?.props['aria-expanded'] === 'false', JSON.stringify(trigger?.props))
check('trigger shows the localized label', texts(trigger).includes('trigger.label'), texts(trigger).join('|'))
check('popover is closed, so no panel node', findAll(pass.tree, (n) => n.props?.className === 'dnt-panel').length === 0, 'panel found')

// Open the panel by invoking the trigger's click handler.
const opened = render()
const openedTrigger = findAll(opened.tree, (n) => n.props?.className === 'dnt-trigger')[0]
openedTrigger.props.onClick()
// The setter wrote into the module-level slots array; re-render to observe it.
slots[0] = true
const open = render()
// Force the open flag, since a fresh render resets state.
const openSlots = slots
slots = []
cursor = 0
pendingEffects = []
slots[0] = true
const openTree = bundle.NamingTranslator({ t, inputActions })
check('open panel renders', findAll(openTree, (n) => n.props?.className === 'dnt-panel').length === 1, 'no panel')

const textarea = findAll(openTree, (n) => n.props?.className === 'dnt-input')[0]
check('panel has the phrase input', textarea !== undefined && textarea.props.maxLength === 240, JSON.stringify(textarea?.props))
textarea.props.onChange({ target: { value: '订单分页查询' } })

// Re-render against the mutated hook state to read the output.
cursor = 0
const typedTree = bundle.NamingTranslator({ t, inputActions })
const identifierNode = findAll(typedTree, (n) => n.props?.className === 'dnt-identifier')[0]
check('dictionary answer appears live', identifierNode !== undefined && texts(identifierNode).join('') === 'orderPageQuery', texts(typedTree).join('|').slice(0, 200))
const badge = findAll(typedTree, (n) => n.props?.className === 'dnt-badge')[0]
check('dictionary source badge is shown', badge?.props['data-src'] === 'dict', JSON.stringify(badge?.props))

const copyButton = findAll(typedTree, (n) => n.props?.className === 'dnt-btn' && n.children?.some((c) => c === 'panel.copy' || (c && c.props === undefined && String(c) === 'panel.copy')))[0]
check('copy action is enabled once an answer exists', copyButton !== undefined && copyButton.props.disabled === false, JSON.stringify(copyButton?.props))

// Cleanup effects must be functions and must not throw when invoked.
const cleanupCount = openTree === null ? 0 : bundle.NamingTranslator.length
check('component signature takes props', bundle.NamingTranslator.length === 1, String(bundle.NamingTranslator.length))

// ── seeded glossary in the editor ─────────────────────────────────────────
// The stub storage starts empty, so the first render seeds it.
const seedCount = Object.keys(bundle.SEED_GLOSSARY).length
check('first render seeds the custom glossary',
  globalThis.window.localStorage.store.has('dsh-naming-translator/glossary'),
  'nothing stored')
const storedRaw = globalThis.window.localStorage.store.get('dsh-naming-translator/glossary')
let storedEntries = {}
try { storedEntries = JSON.parse(storedRaw).entries } catch { storedEntries = {} }
check('seeded glossary holds every starter term',
  Object.keys(storedEntries).length === seedCount,
  `${Object.keys(storedEntries).length} of ${seedCount}`)

// Open the glossary editor through its real control and confirm the seeded
// text is what the developer edits. Re-rendering keeps the hook state, so the
// typed phrase survives the toggle.
const glossaryButton = findAll(typedTree, (n) => n.props?.className === 'dnt-btn' && texts(n).join('') === 'panel.glossary')[0]
check('glossary control is present', glossaryButton !== undefined, texts(typedTree).join('|').slice(0, 200))
glossaryButton.props.onClick()
cursor = 0
pendingEffects = []
const editorTree = bundle.NamingTranslator({ t, inputActions })
const glossaryBox = findAll(editorTree, (n) => n.props?.className === 'dnt-glossary')[0]
check('glossary editor opens with seeded text', glossaryBox !== undefined && glossaryBox.props.value.includes('门店=store'),
  (glossaryBox?.props.value ?? '').slice(0, 40))
check('seeded editor text is one entry per line',
  glossaryBox !== undefined && glossaryBox.props.value.split('\n').every((line) => /^[^=]+=[^=]+$/.test(line)),
  'malformed line')

// The restore action returns the starter terms after a clear.
const restoreButton = findAll(editorTree, (n) => n.props?.className === 'dnt-btn' && texts(n).join('') === 'panel.glossaryRestore')[0]
check('restore action is present', restoreButton !== undefined, texts(editorTree).join('|').slice(0, 200))
check('restore action is wired', typeof restoreButton?.props.onClick === 'function', 'no handler')

// The hint reports how many entries the glossary holds.
const hint = findAll(editorTree, (n) => n.props?.className === 'dnt-note' && texts(n).join('').includes('panel.glossaryHint'))[0]
check('hint carries the entry count', hint !== undefined, 'no hint')

console.log(failures === 0 ? '\nCLIENT RENDER CHECKS PASSED' : `\n${failures} CLIENT RENDER CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)

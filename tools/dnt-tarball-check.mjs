// Verify the published tarball is installable and functional: the manifest
// resolves, the Host half mounts against a stub context, and the browser half
// registers under the package name the patch row names.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.argv[2]
if (!root) throw new Error('usage: node verify-tarball.cjs <extracted package dir>')

let failures = 0
function check(label, condition, detail) {
  if (!condition) failures += 1
  console.log(`${condition ? 'PASS' : 'FAIL'} ${label}${condition ? '' : ` :: ${detail}`}`)
}

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
console.log(`package: ${manifest.name}@${manifest.version}`)

// Every path the manifest promises must exist in the shipped tree.
for (const [field, target] of Object.entries(manifest.exports)) {
  if (typeof target !== 'string' || target.includes('*')) continue
  check(`exports${field} present (${target})`, fs.existsSync(path.join(root, target)), target)
}
check('icon path exists', fs.existsSync(path.join(root, manifest.icon.replace(/^\.\//, ''))), manifest.icon)
check('bundle patch path exists', fs.existsSync(path.join(root, manifest.dsh.bundle.patch.replace(/^\.\//, ''))), manifest.dsh.bundle.patch)

// Both locales the plugin list renders must be in the tarball.
for (const locale of ['en', 'zh']) {
  const file = path.join(root, 'locale', `${locale}.json`)
  check(`${locale} locale shipped`, fs.existsSync(file), file)
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  check(`${locale} has display metadata`, typeof parsed.meta?.title === 'string', JSON.stringify(parsed.meta))
}

// The patch row must name the package the manifest declares.
const patch = fs.readFileSync(path.join(root, manifest.dsh.bundle.patch.replace(/^\.\//, '')), 'utf8')
check('patch names the manifest package', patch.includes(`'${manifest.name}'`), patch)

// Load the real Host half and mount it.
const host = await import(pathToFileURL(path.join(root, manifest.exports['.'])).href)
check('host export is a plugin', typeof host.apply === 'function' || typeof host.default?.apply === 'function',
  Object.keys(host).join(','))
check('host inject list is present', Array.isArray(host.inject ?? host.default?.inject),
  JSON.stringify(host.inject ?? host.default?.inject))

const routes = []
const effects = []
const ctx = {
  effect(fn) { const dispose = fn(); effects.push(dispose) },
  get: () => undefined,
  llm: {
    listProviders: () => [{ id: 'stub', name: 'Stub' }],
    listModels: async () => [{ provider: 'stub', id: 'stub-model', name: 'stub' }],
    stream() {
      return (async function* run() {
        yield { type: 'text-delta', index: 0, text: 'store channel' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  },
  webServer: { register(route) { routes.push(route); return () => {} } },
}
const apply = host.apply ?? host.default.apply
apply(ctx)
check('host mounted exactly one route', routes.length === 1, String(routes.length))
check('route answers the documented path', routes[0]?.path === '/naming-translator/translate', routes[0]?.path)

// Exercise the route end to end through the tarball copy.
const request = {
  method: 'POST',
  headers: { 'x-naming-translator': '1' },
  async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ text: '门店渠道' }), 'utf8') },
}
let body = ''
let status = 0
const response = {
  writeHead(code) { status = code },
  end(chunk) { if (typeof chunk === 'string') body += chunk },
}
await routes[0].handler(request, response)
check('route answers 200 with an identifier', status === 200 && JSON.parse(body).identifier === 'storeChannel',
  `status=${status} body=${body}`)

// Load the browser half the same way the module loader does.
const registrations = []
globalThis.window = { __ModuleLoader__: { load: (registration) => registrations.push(registration) } }
const react = {
  createElement: () => null, useState: (v) => [v, () => {}], useEffect: () => {},
  useRef: () => ({ current: null }), useCallback: (fn) => fn,
}
// eslint-disable-next-line no-new-func
new Function('window', fs.readFileSync(path.join(root, manifest.exports['./client']), 'utf8'))(globalThis.window)
check('browser half registers one bundle', registrations.length === 1, String(registrations.length))
check('browser bundle id equals the package name', registrations[0]?.id === manifest.name, registrations[0]?.id)

const bundle = registrations[0].factory((name) => {
  if (name === 'react') return react
  if (name === 'react-dom') return { createPortal: () => null }
  throw new Error(`unreachable require: ${name}`)
})
check('browser half exports apply', typeof bundle.apply === 'function', typeof bundle.apply)
check('dictionary shipped', Object.keys(bundle.DICT).length > 300, String(Object.keys(bundle.DICT).length))
check('seed glossary shipped', Object.keys(bundle.SEED_GLOSSARY).length > 100, String(Object.keys(bundle.SEED_GLOSSARY).length))
check('seeded phrase resolves', bundle.translateLocally('门店渠道', bundle.SEED_GLOSSARY).identifier === 'storeChannel',
  bundle.translateLocally('门店渠道', bundle.SEED_GLOSSARY).identifier)

console.log(failures === 0 ? '\nTARBALL VERIFICATION PASSED' : `\n${failures} TARBALL CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)

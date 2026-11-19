// Manifest/packaging check: exports resolve, `dsh` metadata is complete, the
// locale dictionaries carry display metadata, and the icon meets the size cap.
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
let failures = 0
function check(label, condition, detail) {
  if (!condition) failures += 1
  console.log(`${condition ? 'PASS' : 'FAIL'} ${label}${condition ? '' : ` :: ${detail}`}`)
}

check('name is publishable and unscoped', manifest.name === 'dsh-naming-translator', manifest.name)
check('package is not marked private', manifest.private !== true, String(manifest.private))
check('manifestVersion is 1', manifest.dsh.manifestVersion === 1, String(manifest.dsh.manifestVersion))
check('bundle patch is declared', manifest.dsh.bundle.patch === './cordis.patch.yml', manifest.dsh.bundle.patch)
check('client platform is web', manifest.dsh.client.platform === 'web', manifest.dsh.client.platform)
check('client inject lists the two packages it mounts into',
  Array.isArray(manifest.dsh.client.inject)
  && manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-locale')
  && manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-conversation'),
  JSON.stringify(manifest.dsh.client.inject))
check('package exports `./client`', manifest.exports['./client'] === './client.js', JSON.stringify(manifest.exports))
check('package exports the locale files', manifest.exports['./locale/*.json'] === './locale/*.json', JSON.stringify(manifest.exports))
check('icon is declared', manifest.icon === './icon.svg', String(manifest.icon))
check('license is declared', typeof manifest.license === 'string' && manifest.license.length > 0, String(manifest.license))
check('engines.dsh is declared', typeof manifest.engines?.dsh === 'string' && manifest.engines.dsh.length > 0,
  JSON.stringify(manifest.engines))
check('repository and homepage are declared',
  typeof manifest.repository?.url === 'string' && typeof manifest.homepage === 'string', JSON.stringify(manifest.repository))
check('prepublishOnly runs the suite', typeof manifest.scripts?.prepublishOnly === 'string', JSON.stringify(manifest.scripts))

for (const required of ['index.js', 'client.js', 'cordis.patch.yml', 'icon.svg', 'README.md', 'LICENSE']) {
  check(`${required} exists`, fs.existsSync(path.join(root, required)), required)
}
for (const required of ['index.js', 'client.js', 'cordis.patch.yml', 'icon.svg', 'locale/*.json', 'README.md', 'LICENSE']) {
  check(`files[] lists ${required}`, manifest.files.includes(required), JSON.stringify(manifest.files))
}
check('tools/ is excluded from the published tarball',
  !manifest.files.some((entry) => entry.startsWith('tools')), JSON.stringify(manifest.files))

const icon = fs.statSync(path.join(root, 'icon.svg'))
check('icon is under 256 KiB', icon.size <= 256 * 1024, String(icon.size))
const iconText = fs.readFileSync(path.join(root, 'icon.svg'), 'utf8')
check('icon is standalone SVG', iconText.startsWith('<svg') && iconText.includes('</svg>'), 'not svg')

for (const locale of ['en', 'zh']) {
  const file = path.join(root, 'locale', `${locale}.json`)
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  check(`${locale}.json has meta.title`, typeof parsed.meta?.title === 'string' && parsed.meta.title.length > 0, JSON.stringify(parsed.meta))
  check(`${locale}.json has meta.description`, typeof parsed.meta?.description === 'string' && parsed.meta.description.length > 0, JSON.stringify(parsed.meta))
}

const patch = fs.readFileSync(path.join(root, 'cordis.patch.yml'), 'utf8')
check('patch inserts the package row', /insert:/.test(patch) && patch.includes("name: 'dsh-naming-translator'"), patch)
check('patch row id matches the client id', /id: naming-translator/.test(patch), patch)
check('patch row name equals the manifest name', patch.includes(`'${manifest.name}'`), patch)

// The client bundle's registration id must equal the package name: the module
// loader keys its registration table by it and the graph row is that same id.
const clientSource = fs.readFileSync(path.join(root, 'client.js'), 'utf8')
check('client registration id equals the package name',
  clientSource.includes(`id: '${manifest.name}'`),
  (clientSource.match(/id: '[^']+'/) ?? [''])[0])
check('client PACKAGE_NAME equals the manifest name',
  clientSource.includes(`const PACKAGE_NAME = '${manifest.name}'`),
  (clientSource.match(/const PACKAGE_NAME = '[^']+'/) ?? [''])[0])
check('no @local/ prefix survives anywhere',
  !['package.json', 'client.js', 'index.js', 'cordis.patch.yml']
    .some((file) => fs.readFileSync(path.join(root, file), 'utf8').includes('@local/')),
  'found @local/')

// Locale key parity between the two in-bundle dictionaries.
const zhBlock = clientSource.slice(clientSource.indexOf('const zh = {'), clientSource.indexOf('const en = {'))
const enBlock = clientSource.slice(clientSource.indexOf('const en = {'), clientSource.indexOf('//#endregion\n\n    //#region plugin'))
const keyPattern = /'([a-z][A-Za-z.]*)':/g
const zhKeys = [...zhBlock.matchAll(keyPattern)].map((match) => match[1])
const enKeys = [...enBlock.matchAll(keyPattern)].map((match) => match[1])
check('zh and en key sets match', zhKeys.length === enKeys.length && zhKeys.every((key) => enKeys.includes(key)),
  `zh=${zhKeys.length} en=${enKeys.length}`)
check('zh dictionary is the larger key set source', zhKeys.length >= 20, String(zhKeys.length))
check('no zero-width space in locale text', !clientSource.includes('\u200b') && !clientSource.includes('\ufeff'), 'found U+200B/U+FEFF')

console.log(failures === 0 ? '\nMANIFEST CHECKS PASSED' : `\n${failures} MANIFEST CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)

// Check the registry submission file against awesome-dsh-plugin's stated rules.
//
// The registry rejects an entry for a wrong `url`, a missing `dsh.bundle`
// manifest, a repo younger than a day, a missing `dsh-plugin` topic, or a
// description that overstates the code. Most of those are checked remotely, so
// this script checks what can be checked from the repository itself and states
// plainly what it cannot.
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const entryFile = path.join(root, '.awesome-dsh-plugin', 'keenleeme__dsh-naming-translator.yml')

let failures = 0
function check(label, condition, detail) {
  if (!condition) failures += 1
  console.log(`${condition ? 'PASS' : 'FAIL'} ${label}${condition ? '' : ` :: ${detail}`}`)
}
function note(label, detail) {
  console.log(`NOTE ${label} :: ${detail}`)
}

if (!fs.existsSync(entryFile)) {
  console.log(`FAIL entry file missing: ${entryFile}`)
  process.exit(1)
}
const entry = fs.readFileSync(entryFile, 'utf8')

// ── file name and required fields ────────────────────────────────────────────
check('file name follows <owner>__<repo>.yml',
  path.basename(entryFile) === 'keenleeme__dsh-naming-translator.yml',
  path.basename(entryFile))

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const urlLine = /^url:\s*(\S+)\s*$/m.exec(entry)
check('url is present', urlLine !== null, 'no url: line')
const repoUrl = urlLine ? urlLine[1] : ''
check('url points at the manifest repository',
  repoUrl === manifest.repository.url.replace(/^git\+/, '').replace(/\.git$/, ''),
  `${repoUrl} vs ${manifest.repository.url}`)
check('url has no trailing slash', !repoUrl.endsWith('/'), repoUrl)

const nameLine = /^name:\s*(\S+)\s*$/m.exec(entry)
check('name is present', nameLine !== null, 'no name: line')
check('name is owner/repo', nameLine !== null && nameLine[1] === 'keenleeme/dsh-naming-translator',
  nameLine ? nameLine[1] : '')

const categoryLine = /^category:\s*(\S+)\s*$/m.exec(entry)
const CATEGORIES = new Set(['agi', 'ui', 'usage', 'theme', 'model', 'identity', 'session', 'memory',
  'tools', 'wsl', 'browser', 'vision', 'voice', 'docs', 'skill', 'workflow', 'git', 'notify', 'dev',
  'security', 'remote', 'market', 'fun'])
check('category is a listed value', categoryLine !== null && CATEGORIES.has(categoryLine[1]),
  categoryLine ? categoryLine[1] : 'missing')

// ── description rules ────────────────────────────────────────────────────────
const enMatch = /^\s+en:\s*(.+)$/m.exec(entry)
const zhMatch = /^\s+zh:\s*(.+)$/m.exec(entry)
check('description.en is present', enMatch !== null, 'missing')
check('description.zh is present', zhMatch !== null, 'missing (optional, but is our work if absent)')

function unquote(value) {
  const trimmed = value.trim()
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}
const en = enMatch ? unquote(enMatch[1]) : ''
const zh = zhMatch ? unquote(zhMatch[1]) : ''

check('en description ends with a period', /[.]$/.test(en), en)
check('zh description ends with a full stop', /[。]$/.test(zh), zh)
// A colon followed by a space breaks the parser unless the scalar is quoted.
for (const [label, raw, value] of [['en', enMatch ? enMatch[1] : '', en], ['zh', zhMatch ? zhMatch[1] : '', zh]]) {
  const quoted = raw.trim().startsWith("'") || raw.trim().startsWith('"')
  const hasBreak = /: /.test(value)
  check(`${label} description is safe for the YAML parser`, !hasBreak || quoted,
    hasBreak ? '": " present but scalar is unquoted' : '')
}
// Marketing language is a rejection reason, not a style note.
const BANNED = /\b(best|fastest|most powerful|ultimate|revolutionary|amazing|world-class|cutting-edge|seamless|unmatched)\b/i
check('en description carries no marketing superlatives', !BANNED.test(en), en)

// ── the claims the description makes must be true of the code ────────────────
const client = fs.readFileSync(path.join(root, 'client.js'), 'utf8')
const dictStart = client.indexOf('const DICT = {')
const dictEnd = client.indexOf('//#endregion', dictStart)
const dictSize = [...client.slice(dictStart, dictEnd).matchAll(/'([^']+)':/g)].length
const seedStart = client.indexOf('const SEED_GLOSSARY = {')
const seedEnd = client.indexOf('//#endregion', seedStart)
const seedSize = [...client.slice(seedStart, seedEnd).matchAll(/'([^']+)':/g)].length

check('code contains a built-in dictionary', dictSize > 300, String(dictSize))
check('code contains a seeded custom glossary', seedSize > 100, String(seedSize))
check('code emits camelCase', /function camelCase\(/.test(client), 'no camelCase function')
check('code registers into the composer tool row',
  client.includes("'conversation.input.left'"), 'slot key not found')
// "one model call only when it cannot cover the phrase" must be visible in code.
check('model fallback runs only on uncovered input',
  /local\.unknown\.length === 0/.test(client), 'no local-coverage gate found')

// ── icon ─────────────────────────────────────────────────────────────────────
const iconLine = /^icon:\s*(\S+)\s*$/m.exec(entry)
check('icon is declared', iconLine !== null, 'missing (optional, but avatars are a worse tile)')
if (iconLine) {
  const iconUrl = iconLine[1]
  check('icon is https on GitHub hosting',
    /^https:\/\/raw\.githubusercontent\.com\//.test(iconUrl), iconUrl)
  check('icon is a raster format, not SVG',
    /\.(png|jpe?g|webp)$/i.test(iconUrl), iconUrl)
  const local = path.join(root, 'assets', path.basename(iconUrl))
  check('icon file exists in the repository', fs.existsSync(local), local)
  if (fs.existsSync(local)) {
    const size = fs.statSync(local).size
    check('icon is a reasonable tile size', size > 0 && size < 256 * 1024, `${size} bytes`)
  }
}

// ── screenshots ──────────────────────────────────────────────────────────────
const shotsFile = path.join(root, 'screenshots.json')
check('screenshots.json exists', fs.existsSync(shotsFile), shotsFile)
if (fs.existsSync(shotsFile)) {
  const parsed = JSON.parse(fs.readFileSync(shotsFile, 'utf8'))
  const shots = Array.isArray(parsed) ? parsed : parsed.screenshots
  check('screenshots.json lists 1-8 images', Array.isArray(shots) && shots.length >= 1 && shots.length <= 8,
    JSON.stringify(shots))
  for (const shot of shots ?? []) {
    check(`screenshot path stays inside the repo: ${shot}`,
      !shot.startsWith('/') && !shot.includes('..'), shot)
    check(`screenshot exists: ${shot}`, fs.existsSync(path.join(root, shot)), shot)
  }
}

// ── fields the registry rejects ──────────────────────────────────────────────
// The npm mapping is collected from the registry automatically; a hand-written
// key is a validation error, so guard against someone adding one.
check('entry declares no npm field', !/^npm:/m.test(entry), 'a hand-written npm: key is rejected')

// ── manifest requirement the registry checks automatically ───────────────────
check('manifest declares dsh.bundle (not only dsh.client)',
  typeof manifest.dsh?.bundle?.patch === 'string', JSON.stringify(manifest.dsh))
check('cordis.patch.yml exists next to the manifest',
  fs.existsSync(path.join(root, 'cordis.patch.yml')), 'missing')
const patch = fs.readFileSync(path.join(root, 'cordis.patch.yml'), 'utf8')
check('patch declares an insert row with id and name',
  /- id: \S+/.test(patch) && patch.includes(`name: '${manifest.name}'`), patch)

check('repo is not a placeholder', fs.readFileSync(path.join(root, 'client.js'), 'utf8').length > 20000,
  'client.js too small to be real code')

// ── what this script cannot verify ───────────────────────────────────────────
note('repo age', 'the registry requires >= 1 day; check the GitHub page before opening the PR')
note('dsh-plugin topic', 'must be set on the GitHub repository, not in these files')
note('description accuracy', 'reviewed against the code by a maintainer; the checks above cover the numeric claims')

console.log(failures === 0 ? '\nREGISTRY ENTRY CHECKS PASSED' : `\n${failures} REGISTRY ENTRY CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)

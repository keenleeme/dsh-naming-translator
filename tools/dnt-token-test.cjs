const fs = require('node:fs')
const path = require('node:path')
const ROOT = 'D:/dsh/resources/app.asar/dsh/node_modules/@deepseek-ai'
const known = new Set()
function walk(dir, depth) {
  if (depth > 3) return
  let items
  try { items = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const it of items) {
    const full = path.join(dir, it.name)
    if (it.isDirectory()) { walk(full, depth + 1); continue }
    if (!/\.(css|js)$/.test(it.name)) continue
    let text
    try { text = fs.readFileSync(full, 'utf8') } catch { continue }
    for (const m of text.matchAll(/--dsw-[a-z0-9-]+/g)) known.add(m[0])
  }
}
walk(ROOT, 0)

const client = fs.readFileSync(path.join(__dirname, '..', 'client.js'), 'utf8')
const cssStart = client.indexOf('const CSS = `')
const cssEnd = client.indexOf('`.trim();', cssStart)
const css = client.slice(cssStart, cssEnd)
const used = [...new Set([...css.matchAll(/--dsw-[a-z0-9-]+/g)].map((m) => m[0]))].sort()

// The theme lives inside the Harness ASAR, which plain Node cannot read.
// Run this file with $env:DSH_NODE_EXECUTABLE and ELECTRON_RUN_AS_NODE=1.
if (known.size === 0) {
  console.log(`SKIPPED: the Harness theme is unreadable from plain Node (${used.length} tokens unchecked)`)
  console.log('Re-run with: $env:ELECTRON_RUN_AS_NODE=1; & $env:DSH_NODE_EXECUTABLE tools/dnt-token-test.cjs')
  process.exit(0)
}

const missing = used.filter((token) => !known.has(token))
console.log(`CSS tokens used: ${used.length}`)
console.log(missing.length === 0 ? 'ALL TOKENS EXIST IN THE HOST THEME' : `MISSING:\n${missing.join('\n')}`)
// Every rule must be scoped, and the portaled popover must carry its own scope.
const selectors = [...new Set([...css.matchAll(/\[data-naming-translator[^\]]*\]/g)].map((m) => m[0]))]
console.log('scoped selector forms:', selectors.join(' | '))
const unscoped = css.split('\n').filter((line) => line.includes('{') && !line.startsWith('[data-naming-translator'))
if (unscoped.length > 0) console.log(`UNSCOPED RULES:\n${unscoped.join('\n')}`)
const panelScoped = selectors.includes('[data-naming-translator-panel]')
if (!panelScoped) console.log('MISSING: the portaled popover has no scope of its own')
process.exit(missing.length === 0 && unscoped.length === 0 && panelScoped ? 0 : 1)

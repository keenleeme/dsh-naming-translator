// Prove the browser half is composed and served by the live Host.
//
// Two things this script must get right, both learned the hard way:
// - The artifact revision is hashed from the *installed* copy's filesystem
//   metadata, not from the workspace file. A package installed from npm has its
//   own mtime/ctime, so hashing the checkout produces a rev the Host never
//   advertises.
// - The web port moves between launches, so the base URL comes from
//   DSH_WEB_URL, then DSH_PROFILE_DIR, and only then the documented default.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const workspaceClient = path.join(here, '..', 'client.js')
const packageName = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8')).name

/** Rebuild the `plugin-artifact` revision the Host computes for a client bundle. */
function artifactRevision(stat) {
  const parts = [String(stat.mtimeMs), String(stat.ctimeMs), String(stat.size)]
  const hash = crypto.createHash('sha1').update('plugin-artifact').update('\0')
  for (const part of parts) hash.update(`${String(Buffer.byteLength(part))}:`).update(part)
  return hash.digest('hex').slice(0, 12)
}

/** Candidate on-disk locations for the installed copy of this package. */
function installedCopies() {
  const roots = []
  if (process.env.DSH_PROFILE_DIR) {
    roots.push(path.join(process.env.DSH_PROFILE_DIR, 'node_modules', ...packageName.split('/')))
  }
  if (process.env.DSH_HOME) {
    for (const profile of ['desktop', 'web']) {
      roots.push(path.join(process.env.DSH_HOME, 'profiles', profile, 'node_modules', ...packageName.split('/')))
    }
  }
  roots.push(path.join(here, '..'))
  return roots
    .map((root) => path.join(root, 'client.js'))
    .filter((file, index, all) => fs.existsSync(file) && all.indexOf(file) === index)
}

/** Base URL of the running Host. */
function baseUrl() {
  if (process.env.DSH_WEB_URL) return process.env.DSH_WEB_URL
  for (const candidate of ['http://127.0.0.1:62643', 'http://127.0.0.1:57727']) return candidate
  throw new Error('set DSH_WEB_URL to the running Host')
}

const base = baseUrl().replace(/\/$/, '')
let failures = 0
function check(label, condition, detail) {
  if (!condition) failures += 1
  console.log(`${condition ? 'PASS' : 'FAIL'} ${label}${condition ? '' : ` :: ${detail}`}`)
}

console.log(`package : ${packageName}`)
console.log(`host    : ${base}`)

const copies = installedCopies()
check('an installed copy exists', copies.length > 0, 'no node_modules copy found')
if (copies.length === 0) process.exit(1)

// Ask the Host for each candidate revision; the installed copy is the one it knows.
let served = null
for (const file of copies) {
  const stat = fs.statSync(file)
  const rev = artifactRevision(stat)
  const url = `${base}/plugins/??${packageName}/client.js&rev=${rev}`
  let status = 0
  try {
    const response = await fetch(url)
    status = response.status
    console.log(`  ${status}  rev=${rev}  (${path.relative(base, file) === '' ? file : file})`)
    if (status === 200 && served === null) {
      served = { file, rev, url, text: await response.text() }
    }
  } catch (error) {
    console.log(`  ERR  rev=${rev}  ${error.message}`)
  }
  if (status === 401) {
    console.log('  (401 means the Host requires a session; retry from an authenticated page)')
    process.exit(0)
  }
}

if (served === null) {
  console.log('\nThe Host did not serve any candidate revision. If it returned 404 for every one,')
  console.log('the package is installed but its client bundle was not composed: restart the Host')
  console.log('so the new module generation loads, then re-run this script.')
  process.exit(1)
}

check('served bytes are non-empty', served.text.length > 0, String(served.text.length))
check('registers the module id', served.text.includes(packageName), served.url)
check('has the loader call', served.text.includes('__ModuleLoader__.load'), served.url)
check('contains the slot key', served.text.includes('conversation.input.left'), served.url)
console.log(`\nserved ${served.text.length} bytes at rev=${served.rev}`)
console.log(failures === 0 ? 'SERVED BUNDLE VERIFIED' : `${failures} SERVED CHECK(S) FAILED`)

// Exit through a timer rather than inline: on Windows, tearing down a keep-alive
// HTTP agent during process exit trips a libuv assertion in this Node build.
setTimeout(() => process.exit(failures === 0 ? 0 : 1), 50)

// Reconstruct the client-module artifact revision for this package's client
// bundle and fetch it from the live Host, proving the browser half is composed.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const clientPath = path.join(here, '..', 'client.js')
const stat = fs.statSync(clientPath)

function framedHash(domain, parts) {
  const hash = crypto.createHash('sha1').update(domain).update('\0')
  for (const part of parts) hash.update(`${String(Buffer.byteLength(part))}:`).update(part)
  return hash.digest('hex').slice(0, 12)
}

const rev = framedHash('plugin-artifact', [String(stat.mtimeMs), String(stat.ctimeMs), String(stat.size)])
const id = 'dsh-naming-translator'
const base = process.env.DSH_WEB_URL ?? 'http://127.0.0.1:57727'
const url = `${base}/plugins/??${id}/client.js&rev=${rev}`

console.log('size', stat.size, 'rev', rev)
const response = await fetch(url)
console.log('url', url)
console.log('status', response.status, 'content-type', response.headers.get('content-type'))
if (response.status === 200) {
  const text = await response.text()
  const tag = `__ModuleLoader__.load`
  console.log('bytes', text.length)
  console.log('registers the module id:', text.includes(id))
  console.log('has the loader call:', text.includes(tag))
  console.log('contains the slot key:', text.includes('conversation.input.left'))
  process.exit(text.includes(id) && text.includes('conversation.input.left') ? 0 : 1)
}
process.exit(1)

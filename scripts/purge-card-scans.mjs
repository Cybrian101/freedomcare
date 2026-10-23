// Removes stored photos of Aadhaar / UDID cards from the private 'documents' bucket (older app versions uploaded them).
// Profile photos and handover photos are never touched.
//   node scripts/purge-card-scans.mjs           list only
//   node scripts/purge-card-scans.mjs --delete  delete them
// Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the environment or .env.local.
import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'

const env = { ...process.env }
if (existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim())
    if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim()
if (!url || !key) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (in .env.local or the environment).')
  process.exit(1)
}
const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
const CARD = /^(aadhaar|udid)\.jpg$/

const found = []
const { data: folders, error } = await sb.storage.from('documents').list('', { limit: 10000 })
if (error) { console.error(error.message); process.exit(1) }
for (const f of folders ?? []) {
  if (f.id || f.name === 'profile') continue // a file at the root, or the profile-photo folder: not a registration folder
  const { data: files, error: e } = await sb.storage.from('documents').list(f.name, { limit: 100 })
  if (e) { console.error(e.message); process.exit(1) }
  for (const x of files ?? []) if (CARD.test(x.name)) found.push(`${f.name}/${x.name}`)
}

console.log(`${found.length} card image(s) found${found.length ? ':' : '.'}`)
for (const p of found) console.log(`  documents/${p}`)
if (!found.length || !process.argv.includes('--delete')) process.exit(0)

const { data: removed, error: de } = await sb.storage.from('documents').remove(found)
if (de) { console.error(de.message); process.exit(1) }
console.log(`Deleted ${removed?.length ?? 0} file(s).`)

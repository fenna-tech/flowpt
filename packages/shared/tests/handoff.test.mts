// Run: node --experimental-strip-types --no-warnings packages/shared/tests/handoff.test.mts
import assert from 'node:assert/strict'
import { generateHandoffKeys, openFromBrowser, sealForDesktop } from '../src/handoff.ts'

const desktop = await generateHandoffKeys()
const secret = JSON.stringify({ access_token: 'a.b.c', refresh_token: 'r'.repeat(40) })
const sealed = await sealForDesktop(desktop.publicKey, 'state-1', secret)

assert.equal(await openFromBrowser(desktop.privateKey, 'state-1', sealed), secret)
console.log('PASS round trip')

await assert.rejects(openFromBrowser(desktop.privateKey, 'state-2', sealed))
console.log('PASS wrong state is rejected')

const other = await generateHandoffKeys()
await assert.rejects(openFromBrowser(other.privateKey, 'state-1', sealed))
console.log('PASS another key cannot open it')

await assert.rejects(
  openFromBrowser(desktop.privateKey, 'state-1', { ...sealed, ct: sealed.ct.slice(0, -2) + 'AA' })
)
console.log('PASS tampering is rejected')

await assert.rejects(sealForDesktop('AAAA', 's', 'x'))
console.log('PASS bad public key is rejected')

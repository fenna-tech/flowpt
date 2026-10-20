// End-to-end encryption for the browser-to-desktop sign-in hand-off.
//
// The desktop app makes a throwaway ECDH key pair and gives the browser only the public half. The
// browser signs in with a passkey, encrypts the new session to that public key and returns it through
// a loopback redirect. Anything that sees the redirect (another local program, browser history, a
// proxy) learns nothing: only the desktop holds the private key, and the `state` value is bound in as
// authenticated data so a ciphertext cannot be replayed into a different sign-in attempt.
// Uses Web Crypto, available in browsers and in Node/Electron.

const subtle = (): SubtleCrypto => globalThis.crypto.subtle

export const toB64Url = (bytes: Uint8Array): string => {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export const fromB64Url = (s: string): Uint8Array<ArrayBuffer> => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export interface HandoffKeys {
  privateKey: CryptoKey
  publicKey: string // base64url, uncompressed P-256 point (65 bytes)
}

export interface SealedSession {
  epk: string // browser's ephemeral public key
  iv: string
  ct: string
}

const ALGO = { name: 'ECDH', namedCurve: 'P-256' } as const

export async function generateHandoffKeys(): Promise<HandoffKeys> {
  const pair = await subtle().generateKey(ALGO, false, ['deriveKey'])
  const raw = new Uint8Array(await subtle().exportKey('raw', pair.publicKey))
  return { privateKey: pair.privateKey, publicKey: toB64Url(raw) }
}

const importPublic = (b64: string): Promise<CryptoKey> => {
  const raw = fromB64Url(b64)
  if (raw.length !== 65 || raw[0] !== 4) throw new Error('Invalid public key')
  return subtle().importKey('raw', raw, ALGO, false, [])
}

const aesKey = (priv: CryptoKey, pub: CryptoKey): Promise<CryptoKey> =>
  subtle().deriveKey({ name: 'ECDH', public: pub }, priv, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt'
  ])

const aad = (state: string): Uint8Array<ArrayBuffer> =>
  new TextEncoder().encode(`flowpt-handoff:${state}`)

// Browser side: seal `plaintext` to the desktop's public key.
export async function sealForDesktop(
  desktopPublicKey: string,
  state: string,
  plaintext: string
): Promise<SealedSession> {
  const ephemeral = await subtle().generateKey(ALGO, false, ['deriveKey'])
  const key = await aesKey(ephemeral.privateKey, await importPublic(desktopPublicKey))
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
  const ct = await subtle().encrypt(
    { name: 'AES-GCM', iv, additionalData: aad(state) },
    key,
    new TextEncoder().encode(plaintext)
  )
  return {
    epk: toB64Url(new Uint8Array(await subtle().exportKey('raw', ephemeral.publicKey))),
    iv: toB64Url(iv),
    ct: toB64Url(new Uint8Array(ct))
  }
}

// Desktop side: open what the browser sealed. Throws if the state or key does not match.
export async function openFromBrowser(
  privateKey: CryptoKey,
  state: string,
  sealed: SealedSession
): Promise<string> {
  const key = await aesKey(privateKey, await importPublic(sealed.epk))
  const plain = await subtle().decrypt(
    { name: 'AES-GCM', iv: fromB64Url(sealed.iv), additionalData: aad(state) },
    key,
    fromB64Url(sealed.ct)
  )
  return new TextDecoder().decode(plain)
}

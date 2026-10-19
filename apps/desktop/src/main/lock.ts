import { BrowserWindow, powerMonitor } from 'electron'
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto'
import { LOCK_TIMEOUT_OPTIONS, type LockStatus } from '@flowpt/shared'
import { logAudit } from './db/audit'
import { getSetting, savePractitioner, getPractitioner, setSetting } from './db/settings'

// The lock gates every data IPC call in the main process (see ipc.ts), not just the UI.
// The PIN hash lives in the encrypted DB; the DB key itself is protected by the OS keychain.

let unlocked = false
let lastActivity = Date.now()
let timer: NodeJS.Timeout | null = null

const MAX_FAILS_BEFORE_DELAY = 5
const MIN_PIN_LENGTH = 6

export const isUnlocked = (): boolean => unlocked
export const touch = (): void => {
  lastActivity = Date.now()
}

export function status(): LockStatus {
  if (!getSetting('pin_hash')) return 'setup'
  return unlocked ? 'unlocked' : 'locked'
}

function notify(): void {
  const s = status()
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('lock:changed', s)
}

function hashPin(pin: string): string {
  const salt = randomBytes(16)
  return `${salt.toString('hex')}:${scryptSync(pin, salt, 32).toString('hex')}`
}

function verifyPin(pin: string): boolean {
  const stored = getSetting('pin_hash')
  if (!stored) return false
  const [saltHex, hashHex] = stored.split(':')
  const expected = Buffer.from(hashHex, 'hex')
  const actual = scryptSync(pin, Buffer.from(saltHex, 'hex'), 32)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

function checkPinFormat(pin: unknown): string {
  if (typeof pin !== 'string' || pin.length < MIN_PIN_LENGTH || pin.length > 64) {
    throw new Error(`PIN or passphrase must be at least ${MIN_PIN_LENGTH} characters`)
  }
  return pin
}

export function setup(name: string, pin: string): void {
  if (status() !== 'setup') throw new Error('Already set up')
  const clean = typeof name === 'string' ? name.trim().slice(0, 100) : ''
  if (!clean) throw new Error('Your name is required')
  const secret = checkPinFormat(pin)
  savePractitioner({ ...getPractitioner(), name: clean })
  setSetting('pin_hash', hashPin(secret))
  unlocked = true
  touch()
  logAudit('app.setup', 'app', 'app', null)
  notify()
}

// Checks a PIN with the shared failure counter and exponential backoff (30s, 60s ... 15 min).
function attemptPin(pin: string): { ok: boolean; retryAfterSec?: number } {
  const now = Date.now()
  const until = Number(getSetting('lock_until') ?? '0')
  if (until > now) return { ok: false, retryAfterSec: Math.ceil((until - now) / 1000) }

  if (typeof pin === 'string' && verifyPin(pin)) {
    setSetting('lock_fails', '0')
    return { ok: true }
  }

  const fails = Number(getSetting('lock_fails') ?? '0') + 1
  setSetting('lock_fails', String(fails))
  logAudit('app.unlock_failed', 'app', 'app', null, `attempt ${fails}`)
  if (fails >= MAX_FAILS_BEFORE_DELAY) {
    const delaySec = Math.min(900, 30 * 2 ** (fails - MAX_FAILS_BEFORE_DELAY))
    setSetting('lock_until', String(now + delaySec * 1000))
    return { ok: false, retryAfterSec: delaySec }
  }
  return { ok: false }
}

// Re-confirms the PIN before sensitive actions (e.g. exporting a backup).
export function confirmPin(pin: string): void {
  const r = attemptPin(pin)
  if (r.ok) return
  throw new Error(
    r.retryAfterSec ? `Too many attempts. Try again in ${r.retryAfterSec}s` : 'Incorrect PIN'
  )
}

export function unlock(pin: string): { ok: boolean; retryAfterSec?: number } {
  const r = attemptPin(pin)
  if (r.ok) {
    unlocked = true
    touch()
    logAudit('app.unlock', 'app', 'app', null)
    notify()
  }
  return r
}

export function lockNow(reason: 'manual' | 'timeout' | 'system' = 'manual'): void {
  if (!unlocked) return
  unlocked = false
  logAudit('app.lock', 'app', 'app', null, reason)
  notify()
}

export const getTimeout = (): number => Number(getSetting('lock_timeout_min') ?? '10')

export function setTimeoutMinutes(minutes: number): void {
  if (!(LOCK_TIMEOUT_OPTIONS as readonly number[]).includes(minutes)) {
    throw new Error('Invalid timeout')
  }
  setSetting('lock_timeout_min', String(minutes))
}

export function changePin(oldPin: string, newPin: string): void {
  if (!verifyPin(oldPin)) throw new Error('Current PIN is incorrect')
  setSetting('pin_hash', hashPin(checkPinFormat(newPin)))
  logAudit('app.pin_changed', 'app', 'app', null)
}

export function startLockWatchers(): void {
  timer = setInterval(() => {
    if (unlocked && Date.now() - lastActivity > getTimeout() * 60_000) lockNow('timeout')
  }, 5000)
  timer.unref()
  powerMonitor.on('lock-screen', () => lockNow('system'))
  powerMonitor.on('suspend', () => lockNow('system'))
}

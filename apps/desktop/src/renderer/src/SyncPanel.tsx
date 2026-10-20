import { useCallback, useEffect, useState } from 'react'
import type { SyncStatus } from '@flowpt/shared'

const inputCls = 'w-full rounded border border-slate-300 px-2 py-1.5 text-sm'
const btn =
  'rounded bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-40'
const msg = (err: unknown): string =>
  (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

function useSyncStatus(intervalMs = 5000): [SyncStatus | null, () => Promise<void>] {
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const refresh = useCallback(async () => setStatus(await window.api.sync.status()), [])
  useEffect(() => {
    const load = (): void => {
      window.api.sync.status().then(setStatus)
    }
    load()
    const t = setInterval(load, intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return [status, refresh]
}

const ago = (iso: string): string => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000))
  return s < 60
    ? 'just now'
    : s < 3600
      ? `${Math.floor(s / 60)} min ago`
      : `${Math.floor(s / 3600)} h ago`
}

// Small status line for the sidebar.
export function SyncBadge(): React.JSX.Element | null {
  const [s] = useSyncStatus(10_000)
  if (!s || s.state === 'unconfigured') return null
  let text = 'Cloud sync: sign in needed'
  let cls = 'text-amber-600'
  if (s.state === 'ready') {
    if (s.syncing) [text, cls] = ['Syncing…', 'text-slate-500']
    else if (s.lastError) [text, cls] = ['Sync problem — see Settings', 'text-red-600']
    else if (s.pending > 0)
      [text, cls] = [`${s.pending} change${s.pending === 1 ? '' : 's'} waiting`, 'text-slate-500']
    else
      [text, cls] = [s.lastSyncAt ? `Synced ${ago(s.lastSyncAt)}` : 'Connected', 'text-green-700']
  }
  return <div className={`px-3 py-1 text-xs ${cls}`}>{text}</div>
}

export function SyncSettings(): React.JSX.Element {
  const [s, refresh] = useSyncStatus()
  const [url, setUrl] = useState('')
  const [key, setKey] = useState('')
  const [editConfig, setEditConfig] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [enroll, setEnroll] = useState<{ factorId: string; qrSvg: string; secret: string } | null>(
    null
  )
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const run = async (fn: () => Promise<unknown>, ok = ''): Promise<void> => {
    setBusy(true)
    setNote('')
    try {
      await fn()
      setNote(ok)
    } catch (err) {
      setNote(msg(err))
    } finally {
      setBusy(false)
      await refresh()
    }
  }

  if (!s) return <div />
  const showConfig = s.state === 'unconfigured' || editConfig

  return (
    <div className="max-w-xl space-y-3">
      <h2 className="text-xl font-semibold">Cloud sync</h2>
      <p className="text-sm text-slate-500">
        Optional. Keeps your data backed up and shared across your devices. Signing in requires an
        authenticator app (MFA). Your project must be in a Canadian region.
      </p>

      {showConfig && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault()
            void run(async () => {
              await window.api.sync.configure(url, key)
              setEditConfig(false)
              setKey('')
            }, 'Saved')
          }}
        >
          <input
            className={inputCls}
            placeholder="Project URL (https://…supabase.co)"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <input
            className={inputCls}
            type="password"
            placeholder="Anon (publishable) key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <button disabled={busy} className={btn}>
            Save project
          </button>
        </form>
      )}

      {!showConfig && s.state === 'signed-out' && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault()
            void run(() => window.api.sync.signIn(email, password))
          }}
        >
          <input
            className={inputCls}
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            className={inputCls}
            type="password"
            placeholder="Password (12+ characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <div className="flex gap-2">
            <button disabled={busy} className={btn}>
              Sign in
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const r = await window.api.sync.signUp(email, password)
                  setNote(
                    r.needsConfirmation
                      ? 'Account created. Confirm the email we sent, then sign in.'
                      : 'Account created. Sign in now.'
                  )
                })
              }
              className="rounded border border-slate-300 px-4 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-40"
            >
              Create account
            </button>
          </div>
        </form>
      )}

      {!showConfig && s.state === 'mfa-needed' && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault()
            void run(async () => {
              await window.api.sync.verifyMfa(code)
              setCode('')
            })
          }}
        >
          <p className="text-sm">Enter the 6-digit code from your authenticator app.</p>
          <input
            className={inputCls}
            inputMode="numeric"
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <button disabled={busy} className={btn}>
            Verify
          </button>
        </form>
      )}

      {!showConfig && s.state === 'mfa-enroll' && (
        <div className="space-y-2">
          {!enroll ? (
            <>
              <p className="text-sm">Set up an authenticator app (required before syncing).</p>
              <button
                disabled={busy}
                className={btn}
                onClick={() => void run(async () => setEnroll(await window.api.sync.enrollMfa()))}
              >
                Set up authenticator
              </button>
            </>
          ) : (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault()
                void run(async () => {
                  await window.api.sync.confirmMfa(enroll.factorId, code)
                  setEnroll(null)
                  setCode('')
                })
              }}
            >
              <p className="text-sm">
                Scan with your authenticator app, then enter the code it shows.
              </p>
              <img
                src={enroll.qrSvg}
                alt="Authenticator QR code"
                className="h-40 w-40 bg-white p-1"
              />
              <p className="break-all text-xs text-slate-500">
                Or enter this key manually: {enroll.secret}
              </p>
              <input
                className={inputCls}
                inputMode="numeric"
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <button disabled={busy} className={btn}>
                Confirm
              </button>
            </form>
          )}
        </div>
      )}

      {!showConfig && s.state === 'ready' && (
        <div className="space-y-2 text-sm">
          <p>
            Signed in as <b>{s.email}</b>.{' '}
            {s.syncing
              ? 'Syncing…'
              : s.lastSyncAt
                ? `Last synced ${ago(s.lastSyncAt)}.`
                : 'Not synced yet.'}
          </p>
          <p className="text-slate-500">
            {s.pending} change{s.pending === 1 ? '' : 's'} waiting to upload.
            {s.conflicts > 0 &&
              ` ${s.conflicts} draft${s.conflicts === 1 ? ' was' : 's were'} replaced by a signed or issued copy from another device.`}
          </p>
          <div className="flex gap-2">
            <button
              disabled={busy || s.syncing}
              className={btn}
              onClick={() => void run(() => window.api.sync.syncNow())}
            >
              Sync now
            </button>
            <button
              disabled={busy}
              className="rounded border border-slate-300 px-4 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-40"
              onClick={() => void run(() => window.api.sync.signOut())}
            >
              Sign out
            </button>
          </div>
        </div>
      )}

      {!showConfig && s.state !== 'unconfigured' && (
        <button
          className="text-xs text-blue-600 hover:underline"
          onClick={() => setEditConfig(true)}
        >
          Change project
        </button>
      )}
      {s.lastError && s.state === 'ready' && <p className="text-sm text-red-600">{s.lastError}</p>}
      {note && <p className="text-sm text-slate-600">{note}</p>}
    </div>
  )
}

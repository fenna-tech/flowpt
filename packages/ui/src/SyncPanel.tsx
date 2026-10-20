import { useState } from 'react'
import type { SyncStatus } from '@flowpt/shared'
import { ago, msg, useSyncStatus } from './syncHooks'
import { FactorSettings } from './Factors'
import { passkeysAvailable, useFactors } from './factorHooks'

const inputCls = 'input'
const btn = 'btn-primary'
const btn2 = 'btn-secondary'

// Small status line for the sidebar.
export function SyncBadge(): React.JSX.Element | null {
  const [s] = useSyncStatus(10_000)
  if (!s || s.state === 'unconfigured' || window.api.platform === 'web') return null
  let text = 'Cloud sync: sign in needed'
  let cls = 'text-amber-600'
  if (s.state === 'ready') {
    if (s.syncing) [text, cls] = ['Syncing…', 'text-slate-500']
    else if (s.lastError) [text, cls] = ['Sync problem — see Settings', 'text-red-600']
    else if (s.pending > 0)
      [text, cls] = [`${s.pending} change${s.pending === 1 ? '' : 's'} waiting`, 'text-slate-500']
    else
      [text, cls] = [s.lastSyncAt ? `Synced ${ago(s.lastSyncAt)}` : 'Connected', 'text-brand-600']
  }
  return <div className={`rounded-lg bg-white px-3 py-2 text-xs font-medium ${cls}`}>{text}</div>
}

// Account + MFA steps, shared by first-run onboarding and Settings.
export function SyncAuth({
  status,
  refresh
}: {
  status: SyncStatus
  refresh: () => Promise<void>
}): React.JSX.Element | null {
  const [mode, setMode] = useState<'signin' | 'create'>('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [enroll, setEnroll] = useState<{ factorId: string; qrSvg: string; secret: string } | null>(
    null
  )
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [factors] = useFactors()
  const passkey = factors?.find((f) => f.type === 'passkey')
  const hasTotp = !factors || factors.some((f) => f.type === 'totp')

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    setNote('')
    try {
      await fn()
    } catch (err) {
      setNote(msg(err))
    } finally {
      setBusy(false)
      await refresh()
    }
  }

  const submit = (): Promise<void> =>
    run(async () => {
      if (mode === 'signin') {
        await window.api.sync.signIn(email, password)
        return
      }
      const r = await window.api.sync.signUp(email, password, name)
      if (r.needsConfirmation) {
        setMode('signin')
        setNote('Account created. Open the confirmation email we sent, then sign in.')
      } else {
        await window.api.sync.signIn(email, password)
      }
    })

  return (
    <div className="space-y-3">
      {status.state === 'signed-out' && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          {mode === 'create' && (
            <input
              className={inputCls}
              placeholder="Your name (shown on signed notes and the audit log)"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
          <input
            className={inputCls}
            type="email"
            placeholder="Email"
            autoFocus={mode === 'signin'}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            className={inputCls}
            type="password"
            placeholder={mode === 'create' ? 'Password (8+ characters)' : 'Password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button disabled={busy} className={`${btn} w-full`}>
            {mode === 'create' ? 'Create account' : 'Sign in'}
          </button>
          <p className="text-xs text-slate-500">
            {mode === 'create' ? 'Already have an account? ' : 'New here? '}
            <button
              type="button"
              className="link"
              onClick={() => {
                setMode(mode === 'create' ? 'signin' : 'create')
                setNote('')
              }}
            >
              {mode === 'create' ? 'Sign in' : 'Create account'}
            </button>
          </p>
        </form>
      )}

      {status.state === 'mfa-needed' && passkey && passkeysAvailable() && (
        <div className="space-y-2">
          <button
            disabled={busy}
            className={`${btn} w-full`}
            onClick={() => void run(() => window.api.sync.factors!.verifyPasskey(passkey.id))}
          >
            Use passkey
          </button>
          {hasTotp && <p className="text-xs text-slate-500">Or use your authenticator app:</p>}
        </div>
      )}

      {status.state === 'mfa-needed' && hasTotp && (
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
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <button disabled={busy} className={btn}>
            Verify
          </button>
        </form>
      )}

      {status.state === 'mfa-enroll' && (
        <div className="space-y-2">
          {!enroll ? (
            <>
              <p className="text-sm">
                Set up an authenticator app (required to protect your account).
              </p>
              <button
                disabled={busy}
                className={btn}
                onClick={() => void run(async () => setEnroll(await window.api.sync.enrollMfa()))}
              >
                Set up authenticator
              </button>
              {passkeysAvailable() && (
                <button
                  disabled={busy}
                  className={btn2}
                  onClick={() =>
                    void run(() =>
                      window.api.sync.factors!.registerPasskey(
                        `Passkey ${new Date().toLocaleDateString('en-CA')}`
                      )
                    )
                  }
                >
                  Use a passkey instead
                </button>
              )}
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

      {note && <p className="text-sm text-slate-600">{note}</p>}
    </div>
  )
}

export function SyncSettings(): React.JSX.Element {
  const [s, refresh] = useSyncStatus()
  const [url, setUrl] = useState('')
  const [key, setKey] = useState('')
  const [editConfig, setEditConfig] = useState(false)
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
  // The web app has no local copy to sync: every change is saved to the cloud as it happens.
  if (window.api.platform === 'web') {
    return (
      <div className="max-w-xl space-y-3">
        <h2 className="section-title">Account</h2>
        <p className="text-sm">
          Signed in as <b>{s.email ?? 'your account'}</b>. Changes are saved to your FlowPT cloud
          account as you make them.
        </p>
        <FactorSettings onChange={refresh} />
        <button
          disabled={busy}
          className={btn2}
          onClick={() => void run(() => window.api.sync.signOut())}
        >
          Sign out
        </button>
        {note && <p className="text-sm text-slate-600">{note}</p>}
      </div>
    )
  }
  // Managed builds ship with the cloud project built in; manual config only exists for dev builds.
  const showConfig = !s.managed && (s.state === 'unconfigured' || editConfig)

  return (
    <div className="max-w-xl space-y-3">
      <h2 className="section-title">Cloud sync</h2>
      <p className="text-sm text-slate-500">
        Keeps your data backed up and shared across your devices. Signing in requires an
        authenticator app (MFA).
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

      {!showConfig && s.state !== 'ready' && s.state !== 'unconfigured' && (
        <SyncAuth status={s} refresh={refresh} />
      )}

      {!showConfig && s.state === 'ready' && (
        <div className="space-y-2 text-sm">
          <p>
            Signed in as <b>{s.email ?? 'your account'}</b>.{' '}
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
              className={btn2}
              onClick={() => void run(() => window.api.sync.signOut())}
            >
              Sign out
            </button>
          </div>
        </div>
      )}

      {!s.managed && !showConfig && s.state !== 'unconfigured' && (
        <button className="text-xs link" onClick={() => setEditConfig(true)}>
          Change project
        </button>
      )}
      {s.lastError && s.state === 'ready' && <p className="text-sm text-red-600">{s.lastError}</p>}
      {note && <p className="text-sm text-slate-600">{note}</p>}
    </div>
  )
}

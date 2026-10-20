import { useState } from 'react'
import { msg } from './syncHooks'
import { passkeysAvailable, usePasskeys } from './factorHooks'

// Passkeys on the signed-in account (web): list, add, remove.
export function PasskeySettings(): React.JSX.Element | null {
  const [passkeys, reload] = usePasskeys()
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const api = window.api.sync.passkeys
  if (!api || !passkeys || !passkeysAvailable()) return null

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    setNote('')
    try {
      await fn()
      reload()
    } catch (err) {
      setNote(msg(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 border-t border-line pt-3">
      <h3 className="text-sm font-medium">Passkeys</h3>
      <p className="text-xs text-slate-500">
        Sign in with your fingerprint, face or a security key instead of typing a password. You will
        still be asked for your authenticator code.
      </p>
      <ul className="space-y-1 text-sm">
        {passkeys.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-3">
            <span>
              {p.name || 'Passkey'}
              <span className="text-slate-500">
                {' '}
                · added {new Date(p.createdAt).toLocaleDateString()}
              </span>
            </span>
            <button
              className="link"
              disabled={busy}
              onClick={() => {
                if (window.confirm('Remove this passkey?')) void run(() => api.remove(p.id))
              }}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void run(async () => {
            await api.register(name)
            setName('')
          })
        }}
      >
        <input
          className="input"
          placeholder="Passkey name (e.g. MacBook Touch ID)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button disabled={busy} className="btn-secondary whitespace-nowrap">
          Add passkey
        </button>
      </form>
      {note && <p className="text-sm text-red-600">{note}</p>}
    </div>
  )
}

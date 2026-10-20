import { useState } from 'react'
import { msg } from './syncHooks'
import { passkeysAvailable, useFactors } from './factorHooks'

// Second-factor management for the signed-in account (web): list, add a passkey, remove.
export function FactorSettings({
  onChange
}: {
  onChange: () => Promise<void>
}): React.JSX.Element | null {
  const [factors, reload] = useFactors()
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const api = window.api.sync.factors
  if (!api || !factors) return null

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    setNote('')
    try {
      await fn()
      reload()
      await onChange()
    } catch (err) {
      setNote(msg(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 border-t border-line pt-3">
      <h3 className="text-sm font-medium">Sign-in verification</h3>
      <ul className="space-y-1 text-sm">
        {factors.map((f) => (
          <li key={f.id} className="flex items-center justify-between gap-3">
            <span>
              {f.type === 'passkey' ? 'Passkey' : 'Authenticator app'}
              {f.name && <span className="text-slate-500"> · {f.name}</span>}
            </span>
            <button
              className="link"
              disabled={busy || factors.length < 2}
              title={factors.length < 2 ? 'Keep at least one way to verify' : ''}
              onClick={() => {
                if (window.confirm('Remove this verification method?'))
                  void run(() => api.remove(f.id))
              }}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      {passkeysAvailable() && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void run(async () => {
              await api.registerPasskey(name)
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
      )}
      {note && <p className="text-sm text-red-600">{note}</p>}
    </div>
  )
}

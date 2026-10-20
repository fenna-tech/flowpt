import { useEffect, useState } from 'react'

const inputCls = 'input'
const msg = (err: unknown): string =>
  (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export function LockScreen({ status }: { status: 'setup' | 'locked' }): React.JSX.Element {
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [wait, setWait] = useState(0)

  useEffect(() => {
    if (wait <= 0) return
    const t = setTimeout(() => setWait(wait - 1), 1000)
    return () => clearTimeout(t)
  }, [wait])

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setError('')
    try {
      if (status === 'setup') {
        if (pin !== confirm) return setError('PINs do not match')
        await window.api.lock.setup(name, pin)
      } else {
        const res = await window.api.lock.unlock(pin)
        if (!res.ok) {
          setPin('')
          if (res.retryAfterSec) {
            setWait(res.retryAfterSec)
            setError('Too many attempts.')
          } else {
            setError('Incorrect PIN')
          }
        }
      }
    } catch (err) {
      setError(msg(err))
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-canvas">
      <form
        onSubmit={submit}
        className="w-80 space-y-3 rounded-2xl border border-line bg-surface p-8 shadow-sm"
      >
        <h1 className="section-title">
          {status === 'setup' ? 'Welcome to FlowPT' : 'FlowPT is locked'}
        </h1>
        {status === 'setup' && (
          <>
            <p className="text-sm text-slate-500">
              Set your name (recorded on signed notes and the audit log) and a PIN or passphrase to
              protect patient data.
            </p>
            <input
              className={inputCls}
              placeholder="Your name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </>
        )}
        <input
          className={inputCls}
          type="password"
          placeholder={status === 'setup' ? 'PIN or passphrase (6+ characters)' : 'PIN'}
          autoFocus={status === 'locked'}
          value={pin}
          onChange={(e) => setPin(e.target.value)}
        />
        {status === 'setup' && (
          <input
            className={inputCls}
            type="password"
            placeholder="Confirm PIN"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        {wait > 0 && <p className="text-sm text-slate-500">Try again in {wait}s</p>}
        <button disabled={wait > 0} className="btn-primary w-full">
          {status === 'setup' ? 'Create' : 'Unlock'}
        </button>
        {status === 'setup' && (
          <p className="text-xs text-slate-400">
            There is no PIN recovery. Keep it somewhere safe.
          </p>
        )}
      </form>
    </div>
  )
}

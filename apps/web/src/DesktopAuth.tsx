import { useMemo, useState } from 'react'
import { sealForDesktop } from '@flowpt/shared'
import { createEphemeralClient } from './api/core'

// Landing page for "Sign in with browser" in the desktop app. The desktop opens
//   /?desktop-auth#port=<loopback port>&state=<random>&pk=<its public key>
// The user taps their passkey here, and the new session is encrypted to the desktop's key and handed
// back through a redirect to http://127.0.0.1:<port>. Nothing is stored in this browser.

interface Request {
  port: number
  state: string
  pk: string
}

function parseRequest(): Request | null {
  const p = new URLSearchParams(window.location.hash.slice(1))
  const port = Number(p.get('port'))
  const state = p.get('state') ?? ''
  const pk = p.get('pk') ?? ''
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return null
  if (!/^[\w-]{16,128}$/.test(state) || !/^[\w-]{80,100}$/.test(pk)) return null
  return { port, state, pk }
}

export function DesktopAuth(): React.JSX.Element {
  const req = useMemo(() => parseRequest(), [])
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  const approve = async (): Promise<void> => {
    if (!req) return
    setBusy(true)
    setError('')
    try {
      const { data, error: err } = await createEphemeralClient().auth.signInWithPasskey()
      if (err) throw new Error(err.message)
      if (!data?.session) throw new Error('Sign-in did not return a session')
      const { access_token, refresh_token } = data.session
      const sealed = await sealForDesktop(
        req.pk,
        req.state,
        JSON.stringify({ access_token, refresh_token })
      )
      const q = new URLSearchParams({ state: req.state, ...sealed })
      setDone(true)
      // Fixed loopback host: the hand-off can only ever go to this computer.
      window.location.href = `http://127.0.0.1:${req.port}/cb?${q.toString()}`
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-canvas">
      <div className="w-96 space-y-3 rounded-2xl border border-line bg-surface p-8 shadow-sm">
        <h1 className="section-title">Sign in to FlowPT desktop</h1>
        {!req ? (
          <p className="text-sm text-red-600">
            This link is not valid. Start again from the FlowPT desktop app.
          </p>
        ) : done ? (
          <p className="text-sm text-slate-600">
            Signed in. You can close this tab and return to the FlowPT app.
          </p>
        ) : (
          <>
            <p className="text-sm text-slate-500">
              Use your passkey to sign in to the FlowPT app on this computer. Only continue if you
              just clicked <b>Sign in with browser</b> in the app.
            </p>
            <button disabled={busy} className="btn-primary w-full" onClick={() => void approve()}>
              Continue with passkey
            </button>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </>
        )}
      </div>
    </div>
  )
}

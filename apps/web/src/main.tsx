import '@flowpt/ui/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '@flowpt/ui'
import { webApi } from './api'
import { isConfigured } from './api/core'
import { DesktopAuth } from './DesktopAuth'

const root = createRoot(document.getElementById('root')!)

if (!isConfigured) {
  root.render(
    <div className="flex h-screen items-center justify-center bg-canvas">
      <div className="w-[28rem] space-y-3 rounded-2xl border border-line bg-surface p-8 shadow-sm">
        <h1 className="section-title">FlowPT is not configured</h1>
        <p className="text-sm text-slate-500">
          Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in{' '}
          <code>apps/web/.env.local</code> (see <code>.env.example</code>), then restart the dev
          server.
        </p>
      </div>
    </div>
  )
} else {
  // The shared UI reads its backend from window.api, exactly as in the desktop app.
  window.api = webApi
  const desktopAuth = new URLSearchParams(window.location.search).has('desktop-auth')
  root.render(<StrictMode>{desktopAuth ? <DesktopAuth /> : <App />}</StrictMode>)
}

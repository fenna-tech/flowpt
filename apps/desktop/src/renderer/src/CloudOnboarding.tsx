import type { SyncStatus } from '@flowpt/shared'
import { SyncAuth } from './SyncPanel'

// The app's front door: shown whenever no account is signed in on this device (first run or after sign-out).
export function CloudOnboarding({
  status,
  refresh
}: {
  status: SyncStatus
  refresh: () => Promise<void>
}): React.JSX.Element {
  const title =
    status.state === 'signed-out'
      ? 'Sign in to FlowPT'
      : status.state === 'ready'
        ? 'Finishing setup…'
        : 'Protect your account'
  return (
    <div className="flex h-screen items-center justify-center bg-canvas">
      <div className="w-96 space-y-3 rounded-2xl border border-line bg-surface p-8 shadow-sm">
        <h1 className="section-title">{title}</h1>
        {status.state === 'signed-out' && (
          <p className="text-sm text-slate-500">
            Your account protects patient data on this device and keeps it backed up across your
            devices. Use the same email on every device.
          </p>
        )}
        <SyncAuth status={status} refresh={refresh} />
        {status.lastError && status.state !== 'ready' && (
          <p className="text-sm text-red-600">{status.lastError}</p>
        )}
      </div>
    </div>
  )
}

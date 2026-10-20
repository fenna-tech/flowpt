import type { SyncStatus } from '@flowpt/shared'
import { SyncAuth } from './SyncPanel'

// Shown once, right after the local PIN is set, until this device is linked to a cloud account.
export function CloudOnboarding({
  status,
  refresh
}: {
  status: SyncStatus
  refresh: () => Promise<void>
}): React.JSX.Element {
  const title =
    status.state === 'signed-out'
      ? 'Create your FlowPT account'
      : status.state === 'ready'
        ? 'Finishing setup…'
        : 'Protect your account'
  return (
    <div className="flex h-screen items-center justify-center bg-slate-100">
      <div className="w-96 space-y-3 rounded-lg bg-white p-6 shadow">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Step 2 of 2</p>
        <h1 className="text-lg font-semibold">{title}</h1>
        {status.state === 'signed-out' && (
          <p className="text-sm text-slate-500">
            Your account keeps your data backed up and available on all your devices. Use the same
            email on every device. Your PIN stays on this device only.
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

import { useCallback, useEffect, useState } from 'react'
import type { SyncStatus } from '@flowpt/shared'

export const msg = (err: unknown): string =>
  (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export const ago = (iso: string): string => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000))
  return s < 60
    ? 'just now'
    : s < 3600
      ? `${Math.floor(s / 60)} min ago`
      : `${Math.floor(s / 3600)} h ago`
}

export function useSyncStatus(intervalMs = 5000): [SyncStatus | null, () => Promise<void>] {
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

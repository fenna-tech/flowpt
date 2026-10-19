import { useEffect, useState } from 'react'
import type { LockStatus } from '@flowpt/shared'

// Reports user activity (throttled) so the main process can auto-lock when idle.
export function useActivityPings(active: boolean): void {
  useEffect(() => {
    if (!active) return
    let last = 0
    const ping = (): void => {
      const now = Date.now()
      if (now - last > 15_000) {
        last = now
        window.api.lock.activity()
      }
    }
    const events = ['mousedown', 'keydown', 'mousemove', 'wheel'] as const
    events.forEach((ev) => window.addEventListener(ev, ping, { passive: true }))
    return () => events.forEach((ev) => window.removeEventListener(ev, ping))
  }, [active])
}

export function useLockStatus(): LockStatus | null {
  const [status, setStatus] = useState<LockStatus | null>(null)
  useEffect(() => {
    window.api.lock.status().then(setStatus)
    return window.api.lock.onChange(setStatus)
  }, [])
  return status
}

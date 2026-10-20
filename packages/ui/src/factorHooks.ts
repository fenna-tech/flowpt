import { useEffect, useState } from 'react'
import type { PasskeyInfo } from '@flowpt/shared'

// Passkeys need the web app's browser APIs; the desktop does not provide `sync.passkeys`.
export const passkeysAvailable = (): boolean =>
  Boolean(window.api.sync.passkeys) && typeof window.PublicKeyCredential !== 'undefined'

export function usePasskeys(): [PasskeyInfo[] | null, () => void] {
  const [passkeys, setPasskeys] = useState<PasskeyInfo[] | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const api = window.api.sync.passkeys
    if (!api) return
    api
      .list()
      .then(setPasskeys)
      .catch(() => setPasskeys([]))
  }, [tick])
  return [passkeys, () => setTick((t) => t + 1)]
}

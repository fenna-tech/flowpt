import { useEffect, useState } from 'react'
import type { MfaFactorInfo } from '@flowpt/shared'

// Passkeys need the web app's browser APIs; the desktop does not provide `sync.factors`.
export const passkeysAvailable = (): boolean =>
  Boolean(window.api.sync.factors) && typeof window.PublicKeyCredential !== 'undefined'

export function useFactors(): [MfaFactorInfo[] | null, () => void] {
  const [factors, setFactors] = useState<MfaFactorInfo[] | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const api = window.api.sync.factors
    if (!api) return
    api
      .list()
      .then(setFactors)
      .catch(() => setFactors([]))
  }, [tick])
  return [factors, () => setTick((t) => t + 1)]
}

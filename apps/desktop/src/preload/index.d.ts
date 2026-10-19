import type { PatientApi } from '@flowpt/shared'

declare global {
  interface Window {
    api: { patients: PatientApi }
  }
}

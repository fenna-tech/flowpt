import type { NoteApi, PatientApi } from '@flowpt/shared'

declare global {
  interface Window {
    api: { patients: PatientApi; notes: NoteApi }
  }
}

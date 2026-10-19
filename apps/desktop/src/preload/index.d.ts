import type { AuditApi, NoteApi, PatientApi } from '@flowpt/shared'

declare global {
  interface Window {
    api: { patients: PatientApi; notes: NoteApi; audit: AuditApi }
  }
}

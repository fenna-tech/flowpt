import type { AuditApi, InvoiceApi, NoteApi, PatientApi, SettingsApi } from '@flowpt/shared'

declare global {
  interface Window {
    api: {
      patients: PatientApi
      notes: NoteApi
      audit: AuditApi
      invoices: InvoiceApi
      settings: SettingsApi
    }
  }
}

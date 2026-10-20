import type {
  AuditApi,
  BackupApi,
  DashboardApi,
  InvoiceApi,
  NoteApi,
  PatientApi,
  SettingsApi,
  SyncApi
} from '@flowpt/shared'

declare global {
  interface Window {
    api: {
      patients: PatientApi
      notes: NoteApi
      audit: AuditApi
      invoices: InvoiceApi
      settings: SettingsApi
      dashboard: DashboardApi
      backup: BackupApi
      sync: SyncApi
    }
  }
}

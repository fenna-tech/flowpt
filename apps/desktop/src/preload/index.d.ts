import type {
  AuditApi,
  BackupApi,
  DashboardApi,
  InvoiceApi,
  LockApi,
  NoteApi,
  PatientApi,
  SettingsApi
} from '@flowpt/shared'

declare global {
  interface Window {
    api: {
      patients: PatientApi
      notes: NoteApi
      audit: AuditApi
      invoices: InvoiceApi
      settings: SettingsApi
      lock: LockApi
      dashboard: DashboardApi
      backup: BackupApi
    }
  }
}

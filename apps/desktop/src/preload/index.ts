import { contextBridge, ipcRenderer } from 'electron'
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

const patients: PatientApi = {
  list: (search) => ipcRenderer.invoke('patients:list', search),
  get: (id) => ipcRenderer.invoke('patients:get', id),
  create: (input) => ipcRenderer.invoke('patients:create', input),
  update: (id, input) => ipcRenderer.invoke('patients:update', id, input),
  remove: (id) => ipcRenderer.invoke('patients:remove', id)
}

const notes: NoteApi = {
  list: (patientId) => ipcRenderer.invoke('notes:list', patientId),
  create: (patientId, templateId, visitDate) =>
    ipcRenderer.invoke('notes:create', patientId, templateId, visitDate),
  update: (id, visitDate, sections) => ipcRenderer.invoke('notes:update', id, visitDate, sections),
  sign: (id) => ipcRenderer.invoke('notes:sign', id),
  addAddendum: (id, text) => ipcRenderer.invoke('notes:addAddendum', id, text),
  remove: (id) => ipcRenderer.invoke('notes:remove', id)
}

const invoices: InvoiceApi = {
  list: (patientId) => ipcRenderer.invoke('invoices:list', patientId),
  create: (patientId, profileId) => ipcRenderer.invoke('invoices:create', patientId, profileId),
  update: (id, input) => ipcRenderer.invoke('invoices:update', id, input),
  issue: (id) => ipcRenderer.invoke('invoices:issue', id),
  markPaid: (id, method, paidDate) => ipcRenderer.invoke('invoices:markPaid', id, method, paidDate),
  void: (id) => ipcRenderer.invoke('invoices:void', id),
  remove: (id) => ipcRenderer.invoke('invoices:remove', id),
  exportPdf: (id) => ipcRenderer.invoke('invoices:exportPdf', id)
}

const settings: SettingsApi = {
  previewInvoice: (p) => ipcRenderer.invoke('settings:previewInvoice', p),
  getPractitioner: () => ipcRenderer.invoke('settings:getPractitioner'),
  savePractitioner: (p) => ipcRenderer.invoke('settings:savePractitioner', p),
  listProfiles: () => ipcRenderer.invoke('settings:listProfiles')
}

const dashboard: DashboardApi = { get: () => ipcRenderer.invoke('dashboard:get') }

const backup: BackupApi = {
  exportTo: (passphrase) => ipcRenderer.invoke('backup:export', passphrase),
  restoreFrom: (passphrase) => ipcRenderer.invoke('backup:restore', passphrase)
}

const sync: SyncApi = {
  status: () => ipcRenderer.invoke('sync:status'),
  configure: (url, key) => ipcRenderer.invoke('sync:configure', url, key),
  signUp: (email, pw, name) => ipcRenderer.invoke('sync:signUp', email, pw, name),
  signIn: (email, pw) => ipcRenderer.invoke('sync:signIn', email, pw),
  verifyMfa: (code) => ipcRenderer.invoke('sync:verifyMfa', code),
  enrollMfa: () => ipcRenderer.invoke('sync:enrollMfa'),
  confirmMfa: (id, code) => ipcRenderer.invoke('sync:confirmMfa', id, code),
  signOut: () => ipcRenderer.invoke('sync:signOut'),
  syncNow: () => ipcRenderer.invoke('sync:syncNow')
}

const audit: AuditApi = {
  list: (patientId) => ipcRenderer.invoke('audit:list', patientId)
}

contextBridge.exposeInMainWorld('api', {
  platform: 'desktop',
  patients,
  notes,
  audit,
  invoices,
  settings,
  dashboard,
  backup,
  sync
})

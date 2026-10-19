import { contextBridge, ipcRenderer } from 'electron'
import type {
  AuditApi,
  BackupApi,
  DashboardApi,
  InvoiceApi,
  LockApi,
  LockStatus,
  NoteApi,
  PatientApi,
  SettingsApi
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
  getPractitioner: () => ipcRenderer.invoke('settings:getPractitioner'),
  savePractitioner: (p) => ipcRenderer.invoke('settings:savePractitioner', p),
  listProfiles: () => ipcRenderer.invoke('settings:listProfiles'),
  saveProfile: (p) => ipcRenderer.invoke('settings:saveProfile', p),
  removeProfile: (id) => ipcRenderer.invoke('settings:removeProfile', id)
}

const lock: LockApi = {
  status: () => ipcRenderer.invoke('lock:status'),
  setup: (name, pin) => ipcRenderer.invoke('lock:setup', name, pin),
  unlock: (pin) => ipcRenderer.invoke('lock:unlock', pin),
  lock: () => ipcRenderer.invoke('lock:lock'),
  activity: () => ipcRenderer.send('lock:activity'),
  getTimeout: () => ipcRenderer.invoke('lock:getTimeout'),
  setTimeout: (minutes) => ipcRenderer.invoke('lock:setTimeout', minutes),
  changePin: (oldPin, newPin) => ipcRenderer.invoke('lock:changePin', oldPin, newPin),
  onChange: (cb) => {
    const handler = (_e: unknown, s: LockStatus): void => cb(s)
    ipcRenderer.on('lock:changed', handler)
    return () => ipcRenderer.removeListener('lock:changed', handler)
  }
}

const dashboard: DashboardApi = { get: () => ipcRenderer.invoke('dashboard:get') }

const backup: BackupApi = {
  exportTo: (pin, passphrase) => ipcRenderer.invoke('backup:export', pin, passphrase),
  restoreFrom: (pin, passphrase) => ipcRenderer.invoke('backup:restore', pin, passphrase)
}

const audit: AuditApi = {
  list: (patientId) => ipcRenderer.invoke('audit:list', patientId)
}

contextBridge.exposeInMainWorld('api', {
  patients,
  notes,
  audit,
  invoices,
  settings,
  lock,
  dashboard,
  backup
})

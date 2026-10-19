import { ipcMain } from 'electron'
import {
  createPatient,
  deletePatient,
  getPatient,
  listPatients,
  updatePatient
} from './db/patients'
import { addAddendum, createNote, deleteNote, listNotes, signNote, updateNote } from './db/notes'
import { listAudit } from './db/audit'
import {
  createInvoice,
  deleteInvoice,
  issueInvoice,
  listInvoices,
  markPaid,
  updateInvoice,
  voidInvoice
} from './db/invoices'
import {
  getPractitioner,
  listProfiles,
  removeProfile,
  saveProfile,
  savePractitioner
} from './db/settings'
import { exportInvoicePdf } from './pdf'
import { getDashboard } from './dashboard'
import { exportBackup, restoreFromFile } from './backup'
import {
  changePin,
  getTimeout,
  isUnlocked,
  lockNow,
  setTimeoutMinutes,
  setup,
  status,
  touch,
  unlock
} from './lock'

// Every data channel goes through `guarded`: while the app is locked, nothing is readable or writable.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (...args: any[]) => unknown

function guarded(channel: string, fn: Handler): void {
  ipcMain.handle(channel, (_e, ...args) => {
    if (!isUnlocked()) throw new Error('App is locked')
    touch()
    return fn(...args)
  })
}

export function registerIpc(): void {
  guarded('patients:list', (search?: string) => listPatients(search))
  guarded('patients:get', (id: string) => getPatient(id))
  guarded('patients:create', (input) => createPatient(input))
  guarded('patients:update', (id: string, input) => updatePatient(id, input))
  guarded('patients:remove', (id: string) => deletePatient(id))

  guarded('notes:list', (patientId: string) => listNotes(patientId))
  guarded('notes:create', (patientId: string, templateId: string, visitDate: string) =>
    createNote(patientId, templateId, visitDate)
  )
  guarded('notes:update', (id: string, visitDate: string, sections) =>
    updateNote(id, visitDate, sections)
  )
  guarded('notes:sign', (id: string) => signNote(id))
  guarded('notes:addAddendum', (id: string, text: string) => addAddendum(id, text))
  guarded('notes:remove', (id: string) => deleteNote(id))

  guarded('invoices:list', (patientId: string) => listInvoices(patientId))
  guarded('invoices:create', (patientId: string, profileId: string) =>
    createInvoice(patientId, profileId)
  )
  guarded('invoices:update', (id: string, input) => updateInvoice(id, input))
  guarded('invoices:issue', (id: string) => issueInvoice(id))
  guarded('invoices:markPaid', (id: string, method: string, paidDate: string) =>
    markPaid(id, method, paidDate)
  )
  guarded('invoices:void', (id: string) => voidInvoice(id))
  guarded('invoices:remove', (id: string) => deleteInvoice(id))
  guarded('invoices:exportPdf', (id: string) => exportInvoicePdf(id))

  guarded('settings:getPractitioner', () => getPractitioner())
  guarded('settings:savePractitioner', (p) => savePractitioner(p))
  guarded('settings:listProfiles', () => listProfiles())
  guarded('settings:saveProfile', (p) => saveProfile(p))
  guarded('settings:removeProfile', (id: string) => removeProfile(id))

  guarded('audit:list', (patientId: string) => listAudit(patientId))

  guarded('dashboard:get', () => getDashboard())
  guarded('backup:export', (pin: string, passphrase: string) => exportBackup(pin, passphrase))
  guarded('backup:restore', (pin: string, passphrase: string) => restoreFromFile(pin, passphrase))

  // Lock channels. Only status/setup/unlock work while locked.
  ipcMain.handle('lock:status', () => status())
  ipcMain.handle('lock:setup', (_e, name: string, pin: string) => setup(name, pin))
  ipcMain.handle('lock:unlock', (_e, pin: string) => unlock(pin))
  guarded('lock:lock', () => lockNow('manual'))
  guarded('lock:getTimeout', () => getTimeout())
  guarded('lock:setTimeout', (minutes: number) => setTimeoutMinutes(minutes))
  guarded('lock:changePin', (oldPin: string, newPin: string) => changePin(oldPin, newPin))
  ipcMain.on('lock:activity', () => {
    if (isUnlocked()) touch()
  })
}

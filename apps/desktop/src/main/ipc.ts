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
import { getPractitioner, listProfiles, savePractitioner } from './db/settings'
import { exportInvoicePdf } from './pdf'
import { getDashboard } from './dashboard'
import { exportBackup, restoreFromFile } from './backup'
import {
  configure,
  confirmMfa,
  enrollMfa,
  isSignedIn,
  signIn,
  signOut,
  signUp,
  status as syncStatus,
  syncNow,
  syncSoon,
  verifyMfa
} from './sync/runtime'

// Every data channel goes through `guarded`: without a signed-in account, nothing is readable or writable.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (...args: any[]) => unknown

const MUTATING = /:(create|update|remove|sign|addAddendum|issue|markPaid|void|savePractitioner)$/

function guarded(channel: string, fn: Handler): void {
  ipcMain.handle(channel, async (_e, ...args) => {
    if (!(await isSignedIn())) throw new Error('Sign in to continue')
    const result = await fn(...args)
    if (MUTATING.test(channel)) syncSoon() // debounced upload after local changes
    return result
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

  guarded('audit:list', (patientId: string) => listAudit(patientId))

  guarded('dashboard:get', () => getDashboard())
  guarded('backup:export', (passphrase: string) => exportBackup(passphrase))
  guarded('backup:restore', (passphrase: string) => restoreFromFile(passphrase))

  ipcMain.handle('sync:status', () => syncStatus())
  ipcMain.handle('sync:configure', (_e, url: string, key: string) => configure(url, key))
  ipcMain.handle('sync:signUp', (_e, email: string, pw: string, name: string) =>
    signUp(email, pw, name)
  )
  ipcMain.handle('sync:signIn', async (_e, email: string, pw: string) => ({
    state: await signIn(email, pw)
  }))
  ipcMain.handle('sync:verifyMfa', async (_e, code: string) => ({ state: await verifyMfa(code) }))
  ipcMain.handle('sync:enrollMfa', () => enrollMfa())
  ipcMain.handle('sync:confirmMfa', async (_e, id: string, code: string) => ({
    state: await confirmMfa(id, code)
  }))
  ipcMain.handle('sync:signOut', () => signOut())
  guarded('sync:syncNow', () => syncNow())
}

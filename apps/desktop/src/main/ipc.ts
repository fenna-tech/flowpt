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

export function registerIpc(): void {
  ipcMain.handle('patients:list', (_e, search?: string) => listPatients(search))
  ipcMain.handle('patients:get', (_e, id: string) => getPatient(id))
  ipcMain.handle('patients:create', (_e, input) => createPatient(input))
  ipcMain.handle('patients:update', (_e, id: string, input) => updatePatient(id, input))
  ipcMain.handle('patients:remove', (_e, id: string) => deletePatient(id))

  ipcMain.handle('notes:list', (_e, patientId: string) => listNotes(patientId))
  ipcMain.handle('notes:create', (_e, patientId: string, templateId: string, visitDate: string) =>
    createNote(patientId, templateId, visitDate)
  )
  ipcMain.handle('notes:update', (_e, id: string, visitDate: string, sections) =>
    updateNote(id, visitDate, sections)
  )
  ipcMain.handle('notes:sign', (_e, id: string) => signNote(id))
  ipcMain.handle('notes:addAddendum', (_e, id: string, text: string) => addAddendum(id, text))
  ipcMain.handle('notes:remove', (_e, id: string) => deleteNote(id))

  ipcMain.handle('invoices:list', (_e, patientId: string) => listInvoices(patientId))
  ipcMain.handle('invoices:create', (_e, patientId: string, profileId: string) =>
    createInvoice(patientId, profileId)
  )
  ipcMain.handle('invoices:update', (_e, id: string, input) => updateInvoice(id, input))
  ipcMain.handle('invoices:issue', (_e, id: string) => issueInvoice(id))
  ipcMain.handle('invoices:markPaid', (_e, id: string, method: string, paidDate: string) =>
    markPaid(id, method, paidDate)
  )
  ipcMain.handle('invoices:void', (_e, id: string) => voidInvoice(id))
  ipcMain.handle('invoices:remove', (_e, id: string) => deleteInvoice(id))
  ipcMain.handle('invoices:exportPdf', (_e, id: string) => exportInvoicePdf(id))

  ipcMain.handle('settings:getPractitioner', () => getPractitioner())
  ipcMain.handle('settings:savePractitioner', (_e, p) => savePractitioner(p))
  ipcMain.handle('settings:listProfiles', () => listProfiles())
  ipcMain.handle('settings:saveProfile', (_e, p) => saveProfile(p))
  ipcMain.handle('settings:removeProfile', (_e, id: string) => removeProfile(id))

  ipcMain.handle('audit:list', (_e, patientId: string) => listAudit(patientId))
}

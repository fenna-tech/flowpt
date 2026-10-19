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

  ipcMain.handle('audit:list', (_e, patientId: string) => listAudit(patientId))
}

import { ipcMain } from 'electron'
import {
  createPatient,
  deletePatient,
  getPatient,
  listPatients,
  updatePatient
} from './db/patients'
import { createNote, deleteNote, listNotes, updateNote } from './db/notes'

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
  ipcMain.handle('notes:remove', (_e, id: string) => deleteNote(id))
}

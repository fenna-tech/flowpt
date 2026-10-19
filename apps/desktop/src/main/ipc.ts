import { ipcMain } from 'electron'
import {
  createPatient,
  deletePatient,
  getPatient,
  listPatients,
  updatePatient
} from './db/patients'

export function registerIpc(): void {
  ipcMain.handle('patients:list', (_e, search?: string) => listPatients(search))
  ipcMain.handle('patients:get', (_e, id: string) => getPatient(id))
  ipcMain.handle('patients:create', (_e, input) => createPatient(input))
  ipcMain.handle('patients:update', (_e, id: string, input) => updatePatient(id, input))
  ipcMain.handle('patients:remove', (_e, id: string) => deletePatient(id))
}

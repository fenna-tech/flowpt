import { contextBridge, ipcRenderer } from 'electron'
import type { PatientApi } from '@flowpt/shared'

const patients: PatientApi = {
  list: (search) => ipcRenderer.invoke('patients:list', search),
  get: (id) => ipcRenderer.invoke('patients:get', id),
  create: (input) => ipcRenderer.invoke('patients:create', input),
  update: (id, input) => ipcRenderer.invoke('patients:update', id, input),
  remove: (id) => ipcRenderer.invoke('patients:remove', id)
}

contextBridge.exposeInMainWorld('api', { patients })

import { contextBridge, ipcRenderer } from 'electron'
import type { AuditApi, NoteApi, PatientApi } from '@flowpt/shared'

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

const audit: AuditApi = {
  list: (patientId) => ipcRenderer.invoke('audit:list', patientId)
}

contextBridge.exposeInMainWorld('api', { patients, notes, audit })

import type { AuditEntry } from '@flowpt/shared'
import { getDb } from './connection'
import { currentActor } from './settings'

// Call inside the same transaction as the change it records. `detail` must be metadata only
// (field names, template ids); never put clinical or identifying content in the log.
export function logAudit(
  action: string,
  entity: string,
  entityId: string,
  patientId: string | null,
  detail = ''
): void {
  getDb()
    .prepare(
      `INSERT INTO audit_log (ts, action, entity, entity_id, patient_id, actor, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(new Date().toISOString(), action, entity, entityId, patientId, currentActor(), detail)
}

export function listAudit(patientId: string): AuditEntry[] {
  return (
    getDb()
      .prepare(
        `SELECT id, ts, action, entity, entity_id, patient_id, actor, detail FROM audit_log
         WHERE patient_id = ? ORDER BY id DESC LIMIT 500`
      )
      .all(patientId) as {
      id: number
      ts: string
      action: string
      entity: string
      entity_id: string
      patient_id: string | null
      actor: string
      detail: string
    }[]
  ).map((r) => ({
    id: r.id,
    ts: r.ts,
    action: r.action,
    entity: r.entity,
    entityId: r.entity_id,
    patientId: r.patient_id,
    actor: r.actor,
    detail: r.detail
  }))
}

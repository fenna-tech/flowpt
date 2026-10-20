import type { AuditApi } from '@flowpt/shared'
import { check, supabase } from './core'

interface Row {
  id: string
  ts: string
  action: string
  entity: string
  entity_id: string
  patient_id: string | null
  actor: string
  detail: string
}

export const auditApi: AuditApi = {
  async list(patientId) {
    const rows = check(
      await supabase
        .from('audit_log')
        .select('id, ts, action, entity, entity_id, patient_id, actor, detail')
        .eq('patient_id', patientId)
        .order('ts', { ascending: false })
        .limit(500)
    ) as Row[]
    return rows.map((r) => ({
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
}

import { buildDashboard, type DashboardData, type LineItem } from '@flowpt/shared'
import { getDb } from './db/connection'

interface Row {
  id: string
  number: string
  patient_id: string
  first_name: string
  last_name: string
  status: 'issued' | 'paid'
  issue_date: string
  paid_at: string | null
  items: string
  tax_pct: number
}

export function getDashboard(): DashboardData {
  const rows = getDb()
    .prepare(
      `SELECT i.id, i.number, i.patient_id, p.first_name, p.last_name, i.status, i.issue_date,
              i.paid_at, i.items, i.tax_pct
       FROM invoices i JOIN patients p ON p.id = i.patient_id
       WHERE i.deleted_at IS NULL AND i.status IN ('issued','paid')`
    )
    .all() as Row[]
  return buildDashboard(
    rows.map((r) => ({
      id: r.id,
      number: r.number,
      patientId: r.patient_id,
      patientName: `${r.first_name} ${r.last_name}`,
      status: r.status,
      issueDate: r.issue_date,
      paidAt: r.paid_at,
      items: JSON.parse(r.items) as LineItem[],
      taxPct: r.tax_pct
    }))
  )
}

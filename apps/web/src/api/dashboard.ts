import { buildDashboard, type DashboardApi, type LineItem } from '@flowpt/shared'
import { fetchAll, supabase } from './core'

interface Row {
  id: string
  number: string
  patient_id: string
  status: 'issued' | 'paid'
  issue_date: string
  paid_at: string | null
  items: LineItem[]
  tax_pct: number | string
  patients: { first_name: string; last_name: string } | null
}

export const dashboard: DashboardApi = {
  async get() {
    const rows = await fetchAll<Row>((from, to) =>
      supabase
        .from('invoices')
        .select(
          'id, number, patient_id, status, issue_date, paid_at, items, tax_pct, patients(first_name, last_name)'
        )
        .is('deleted_at', null)
        .in('status', ['issued', 'paid'])
        .order('id')
        .range(from, to)
    )
    return buildDashboard(
      rows.map((r) => ({
        id: r.id,
        number: r.number,
        patientId: r.patient_id,
        patientName: r.patients ? `${r.patients.first_name} ${r.patients.last_name}` : '',
        status: r.status,
        issueDate: r.issue_date,
        paidAt: r.paid_at,
        items: r.items,
        taxPct: Number(r.tax_pct)
      }))
    )
  }
}

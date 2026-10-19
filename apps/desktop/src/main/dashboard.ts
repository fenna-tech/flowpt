import {
  computeTotals,
  type DashboardData,
  type LineItem,
  type MonthlyRevenue,
  type OutstandingInvoice
} from '@flowpt/shared'
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

const localDate = (d: Date): string => d.toLocaleDateString('en-CA') // YYYY-MM-DD
const dayMs = 86_400_000

// Cash-basis view for a solo practice: loads issued/paid invoices (void and drafts excluded).
export function getDashboard(): DashboardData {
  const rows = getDb()
    .prepare(
      `SELECT i.id, i.number, i.patient_id, p.first_name, p.last_name, i.status, i.issue_date,
              i.paid_at, i.items, i.tax_pct
       FROM invoices i JOIN patients p ON p.id = i.patient_id
       WHERE i.deleted_at IS NULL AND i.status IN ('issued','paid')`
    )
    .all() as Row[]

  const now = new Date()
  const today = localDate(now)
  const thisMonth = today.slice(0, 7)
  const year = today.slice(0, 4)

  const months: MonthlyRevenue[] = []
  for (let k = 11; k >= 0; k--) {
    const d = new Date(now.getFullYear(), now.getMonth() - k, 1)
    months.push({ month: localDate(d).slice(0, 7), invoicedCents: 0, collectedCents: 0 })
  }
  const byMonth = new Map(months.map((m) => [m.month, m]))

  const outstanding: OutstandingInvoice[] = []
  let collectedThisMonthCents = 0
  let collectedYtdCents = 0
  let invoicedYtdCents = 0

  for (const r of rows) {
    const total = computeTotals(JSON.parse(r.items) as LineItem[], r.tax_pct).totalCents
    const issued = byMonth.get(r.issue_date.slice(0, 7))
    if (issued) issued.invoicedCents += total
    if (r.issue_date.startsWith(year)) invoicedYtdCents += total

    if (r.status === 'paid' && r.paid_at) {
      const m = r.paid_at.slice(0, 7)
      const bucket = byMonth.get(m)
      if (bucket) bucket.collectedCents += total
      if (m === thisMonth) collectedThisMonthCents += total
      if (r.paid_at.startsWith(year)) collectedYtdCents += total
    } else if (r.status === 'issued') {
      outstanding.push({
        id: r.id,
        number: r.number,
        patientId: r.patient_id,
        patientName: `${r.first_name} ${r.last_name}`,
        issueDate: r.issue_date,
        totalCents: total,
        daysOutstanding: Math.max(
          0,
          Math.floor((Date.parse(today) - Date.parse(r.issue_date)) / dayMs)
        )
      })
    }
  }

  outstanding.sort((a, b) => b.daysOutstanding - a.daysOutstanding)
  return {
    outstanding,
    outstandingCents: outstanding.reduce((s, o) => s + o.totalCents, 0),
    over30Count: outstanding.filter((o) => o.daysOutstanding > 30).length,
    collectedThisMonthCents,
    collectedYtdCents,
    invoicedYtdCents,
    months
  }
}

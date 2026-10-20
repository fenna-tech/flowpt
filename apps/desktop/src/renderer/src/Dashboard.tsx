import { useEffect, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import { formatMoney, type DashboardData } from '@flowpt/shared'

const monthLabel = (m: string): string =>
  new Date(`${m}-01T12:00:00`).toLocaleDateString('en-CA', { month: 'short', year: '2-digit' })

function Stat({
  label,
  value,
  tone
}: {
  label: string
  value: string
  tone?: string
}): React.JSX.Element {
  return (
    <div className="px-6 py-5">
      <div className={`text-3xl font-semibold tracking-tight ${tone ?? ''}`}>{value}</div>
      <div className="mt-1 text-sm text-muted">{label}</div>
    </div>
  )
}

export function Dashboard({
  onOpenInvoice
}: {
  onOpenInvoice: (patientId: string) => void
}): React.JSX.Element {
  const [data, setData] = useState<DashboardData | null>(null)
  useEffect(() => {
    window.api.dashboard.get().then(setData)
  }, [])
  if (!data) return <div />

  const chart = data.months.map((m) => ({
    name: monthLabel(m.month),
    Invoiced: m.invoicedCents / 100,
    Collected: m.collectedCents / 100
  }))

  return (
    <div className="space-y-8">
      <h2 className="page-title">Overview</h2>
      <div className="card grid grid-cols-2 divide-line md:grid-cols-4 md:divide-x">
        <Stat label="Outstanding" value={formatMoney(data.outstandingCents)} />
        <Stat
          label="Outstanding 30+ days"
          value={String(data.over30Count)}
          tone={data.over30Count > 0 ? 'text-red-600' : ''}
        />
        <Stat label="Collected this month" value={formatMoney(data.collectedThisMonthCents)} />
        <Stat label="Collected year to date" value={formatMoney(data.collectedYtdCents)} />
      </div>

      <section className="card p-6">
        <h3 className="section-title mb-4">Last 12 months</h3>
        <div
          role="img"
          aria-label="Bar chart of invoiced and collected revenue per month"
          className="h-64"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart}>
              <CartesianGrid stroke="#e8eaee" vertical={false} />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 12, fill: '#6b7280' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 12, fill: '#6b7280' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => `$${v}`}
              />
              <Tooltip
                cursor={{ fill: '#f7f8fa' }}
                contentStyle={{ borderRadius: 10, border: '1px solid #e8eaee' }}
                formatter={(v) => formatMoney(Math.round(Number(v) * 100))}
              />
              <Legend />
              <Bar dataKey="Invoiced" fill="#b4d1c9" radius={[6, 6, 0, 0]} />
              <Bar dataKey="Collected" fill="#0a3d34" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section>
        <h3 className="section-title mb-3">Outstanding invoices ({data.outstanding.length})</h3>
        {data.outstanding.length === 0 ? (
          <p className="subtle">Nothing outstanding.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="table-head">
              <tr>
                <th className="rounded-l-lg px-4 py-3 font-medium">Invoice</th>
                <th className="px-4 py-3 font-medium">Patient</th>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="rounded-r-lg px-4 py-3 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.outstanding.map((o) => (
                <tr
                  key={o.id}
                  onClick={() => onOpenInvoice(o.patientId)}
                  className="table-row cursor-pointer transition hover:bg-canvas"
                >
                  <td className="px-4 py-4 font-medium">{o.number}</td>
                  <td className="px-4 py-4">{o.patientName}</td>
                  <td className="px-4 py-4 text-slate-600">{o.issueDate}</td>
                  <td className="px-4 py-4">
                    <span className={o.daysOutstanding > 30 ? 'pill-void' : 'pill-unpaid'}>
                      {o.daysOutstanding > 30 ? 'Overdue' : 'Unpaid'} · {o.daysOutstanding}d
                    </span>
                  </td>
                  <td className="px-4 py-4 text-right font-medium">{formatMoney(o.totalCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}

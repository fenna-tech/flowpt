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
    <div className="rounded border border-slate-200 bg-white p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${tone ?? ''}`}>{value}</div>
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
    <div className="max-w-4xl space-y-6">
      <h2 className="text-xl font-semibold">Dashboard</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Outstanding" value={formatMoney(data.outstandingCents)} />
        <Stat
          label="Outstanding 30+ days"
          value={String(data.over30Count)}
          tone={data.over30Count > 0 ? 'text-red-600' : ''}
        />
        <Stat label="Collected this month" value={formatMoney(data.collectedThisMonthCents)} />
        <Stat label="Collected year to date" value={formatMoney(data.collectedYtdCents)} />
      </div>

      <section className="rounded border border-slate-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-medium text-slate-700">Last 12 months</h3>
        <div
          role="img"
          aria-label="Bar chart of invoiced and collected revenue per month"
          className="h-64"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} tickFormatter={(v: number) => `$${v}`} />
              <Tooltip formatter={(v) => formatMoney(Math.round(Number(v) * 100))} />
              <Legend />
              <Bar dataKey="Invoiced" fill="#94a3b8" />
              <Bar dataKey="Collected" fill="#2563eb" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-medium text-slate-700">
          Outstanding invoices ({data.outstanding.length})
        </h3>
        {data.outstanding.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing outstanding.</p>
        ) : (
          <table className="w-full rounded border border-slate-200 bg-white text-left text-sm">
            <thead className="text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2">Invoice</th>
                <th className="px-3 py-2">Patient</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Age</th>
                <th className="px-3 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.outstanding.map((o) => (
                <tr
                  key={o.id}
                  onClick={() => onOpenInvoice(o.patientId)}
                  className="cursor-pointer border-t border-slate-200 hover:bg-slate-50"
                >
                  <td className="px-3 py-2">{o.number}</td>
                  <td className="px-3 py-2">{o.patientName}</td>
                  <td className="px-3 py-2">{o.issueDate}</td>
                  <td className={`px-3 py-2 ${o.daysOutstanding > 30 ? 'text-red-600' : ''}`}>
                    {o.daysOutstanding}d
                  </td>
                  <td className="px-3 py-2 text-right">{formatMoney(o.totalCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}

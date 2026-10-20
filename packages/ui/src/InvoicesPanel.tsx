import { useCallback, useEffect, useState } from 'react'
import {
  PAYMENT_METHODS,
  computeTotals,
  formatMoney,
  type BillingProfile,
  type Invoice,
  type LineItem
} from '@flowpt/shared'

const inputCls = 'input'
const today = (): string => new Date().toLocaleDateString('en-CA')
const msg = (err: unknown): string =>
  (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

// Prices are edited as dollar strings and converted to integer cents on save.
interface Row {
  description: string
  code: string
  quantity: string
  price: string
}
const toRows = (items: LineItem[]): Row[] =>
  items.map((i) => ({
    description: i.description,
    code: i.code,
    quantity: String(i.quantity),
    price: (i.unitCents / 100).toFixed(2)
  }))
const toItems = (rows: Row[]): LineItem[] =>
  rows.map((r) => ({
    description: r.description,
    code: r.code,
    quantity: Number(r.quantity) || 0,
    unitCents: Math.round((Number(r.price) || 0) * 100)
  }))

const statusCls: Record<string, string> = {
  draft: 'pill-pending',
  issued: 'pill-unpaid',
  paid: 'pill-paid',
  void: 'pill-void'
}

function InvoiceEditor({
  invoice,
  profiles,
  onChanged
}: {
  invoice: Invoice
  profiles: BillingProfile[]
  onChanged: () => void
}): React.JSX.Element {
  const [profileId, setProfileId] = useState(invoice.profileId)
  const [issueDate, setIssueDate] = useState(invoice.issueDate)
  const [payerName, setPayerName] = useState(invoice.payerName)
  const [policyNumber, setPolicyNumber] = useState(invoice.policyNumber)
  const [taxPct, setTaxPct] = useState(String(invoice.taxPct))
  const [notes, setNotes] = useState(invoice.notes)
  const [rows, setRows] = useState<Row[]>(toRows(invoice.items))
  const [method, setMethod] = useState<string>(PAYMENT_METHODS[1])
  const [status, setStatus] = useState('')

  const draft = invoice.status === 'draft'
  const profile = profiles.find((p) => p.id === profileId) ?? profiles[0]
  const items = toItems(rows)
  const totals = computeTotals(
    draft ? items : invoice.items,
    draft ? Number(taxPct) || 0 : invoice.taxPct
  )

  const input = (): Parameters<typeof window.api.invoices.update>[1] => ({
    profileId,
    issueDate,
    payerName,
    policyNumber,
    items,
    taxPct: Number(taxPct) || 0,
    notes
  })

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    try {
      await fn()
      setStatus('')
      onChanged()
    } catch (err) {
      setStatus(msg(err))
    }
  }

  const save = (): Promise<void> => run(() => window.api.invoices.update(invoice.id, input()))
  const issue = (): Promise<void> => {
    if (!window.confirm('Issue this invoice? It will be numbered and locked.'))
      return Promise.resolve()
    return run(async () => {
      await window.api.invoices.update(invoice.id, input())
      await window.api.invoices.issue(invoice.id)
    })
  }
  const remove = (): Promise<void> => {
    if (!window.confirm('Delete this draft invoice?')) return Promise.resolve()
    return run(() => window.api.invoices.remove(invoice.id))
  }
  const voidIt = (): Promise<void> => {
    if (!window.confirm('Void this invoice? This cannot be undone.')) return Promise.resolve()
    return run(() => window.api.invoices.void(invoice.id))
  }
  const pay = (): Promise<void> =>
    run(() => window.api.invoices.markPaid(invoice.id, method, today()))
  const exportPdf = async (): Promise<void> => {
    try {
      const res = await window.api.invoices.exportPdf(invoice.id)
      setStatus(res.saved ? `Saved to ${res.path}` : '')
    } catch (err) {
      setStatus(msg(err))
    }
  }

  const setRow = (i: number, patch: Partial<Row>): void =>
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  const cell = `${inputCls} disabled:bg-slate-50`

  return (
    <div className="space-y-4 card p-5">
      <div className="grid grid-cols-2 gap-3 text-sm">
        <label>
          <span className="field-label">Funding type</span>
          <select
            className={cell}
            disabled={!draft}
            value={profileId}
            onChange={(e) => {
              setProfileId(e.target.value)
              const p = profiles.find((x) => x.id === e.target.value)
              if (p) setTaxPct(String(p.defaultTaxPct))
            }}
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="field-label">Invoice date</span>
          <input
            type="date"
            className={cell}
            disabled={!draft}
            value={issueDate}
            onChange={(e) => setIssueDate(e.target.value)}
          />
        </label>
        {profile?.payerLabel && (
          <>
            <label>
              <span className="field-label">{profile.payerLabel} name</span>
              <input
                className={cell}
                disabled={!draft}
                value={payerName}
                onChange={(e) => setPayerName(e.target.value)}
              />
            </label>
            <label>
              <span className="field-label">
                Policy / claim #{profile.requirePolicyNumber ? '' : ' (optional)'}
              </span>
              <input
                className={cell}
                disabled={!draft}
                value={policyNumber}
                onChange={(e) => setPolicyNumber(e.target.value)}
              />
            </label>
          </>
        )}
      </div>

      <table className="w-full text-sm">
        <thead className="text-left text-xs font-medium text-slate-500">
          <tr>
            <th className="pr-2">Description</th>
            <th className="w-24 pr-2">Code{profile?.requireServiceCode ? ' *' : ''}</th>
            <th className="w-16 pr-2">Qty</th>
            <th className="w-24 pr-2">Price</th>
            <th className="w-24 text-right">Amount</th>
            <th className="w-6" />
          </tr>
        </thead>
        <tbody>
          {(draft ? rows : toRows(invoice.items)).map((r, i) => (
            <tr key={i}>
              <td className="pr-2 pb-1">
                <input
                  className={cell}
                  disabled={!draft}
                  value={r.description}
                  onChange={(e) => setRow(i, { description: e.target.value })}
                />
              </td>
              <td className="pr-2 pb-1">
                <input
                  className={cell}
                  disabled={!draft}
                  value={r.code}
                  onChange={(e) => setRow(i, { code: e.target.value })}
                />
              </td>
              <td className="pr-2 pb-1">
                <input
                  className={cell}
                  disabled={!draft}
                  inputMode="decimal"
                  value={r.quantity}
                  onChange={(e) => setRow(i, { quantity: e.target.value })}
                />
              </td>
              <td className="pr-2 pb-1">
                <input
                  className={cell}
                  disabled={!draft}
                  inputMode="decimal"
                  value={r.price}
                  onChange={(e) => setRow(i, { price: e.target.value })}
                />
              </td>
              <td className="pb-1 text-right">
                {formatMoney(
                  Math.round((Number(r.quantity) || 0) * Math.round((Number(r.price) || 0) * 100))
                )}
              </td>
              <td className="pb-1 text-right">
                {draft && (
                  <button
                    title="Remove line"
                    onClick={() => setRows(rows.filter((_, j) => j !== i))}
                    className="text-slate-400 hover:text-red-600"
                  >
                    ×
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {draft && (
        <button
          onClick={() =>
            setRows([...rows, { description: '', code: '', quantity: '1', price: '' }])
          }
          className="text-sm link"
        >
          + Add line
        </button>
      )}

      <div className="ml-auto w-56 space-y-1 text-sm">
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span>{formatMoney(totals.subtotalCents)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>
            Tax{' '}
            <input
              className="input w-16! px-1.5! py-0.5! text-right"
              disabled={!draft}
              inputMode="decimal"
              value={draft ? taxPct : String(invoice.taxPct)}
              onChange={(e) => setTaxPct(e.target.value)}
            />{' '}
            %
          </span>
          <span>{formatMoney(totals.taxCents)}</span>
        </div>
        <div className="flex justify-between border-t border-line pt-2 font-semibold">
          <span>Total</span>
          <span>{formatMoney(totals.totalCents)}</span>
        </div>
      </div>

      <label className="block text-sm">
        <span className="field-label">Notes (printed on invoice)</span>
        <textarea
          className={cell}
          rows={2}
          disabled={!draft}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>

      {status && <p className="text-sm text-red-600">{status}</p>}

      <div className="flex flex-wrap items-center gap-2">
        {draft ? (
          <>
            <button onClick={save} className="btn-primary">
              Save draft
            </button>
            <button onClick={issue} className="btn-accent">
              Issue
            </button>
            <button onClick={remove} className="btn-danger">
              Delete draft
            </button>
          </>
        ) : (
          <>
            <button onClick={exportPdf} className="btn-primary">
              {window.api.platform === 'web' ? 'Print / save PDF' : 'Export PDF'}
            </button>
            {invoice.status === 'issued' && (
              <>
                <select
                  className="input w-auto!"
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <button onClick={pay} className="btn-accent">
                  Mark paid
                </button>
              </>
            )}
            {invoice.status !== 'void' && (
              <button onClick={voidIt} className="btn-danger">
                Void
              </button>
            )}
            {invoice.status === 'paid' && (
              <span className="text-sm text-slate-500">
                Paid {invoice.paidAt} ({invoice.paymentMethod})
              </span>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export function InvoicesPanel({ patientId }: { patientId: string }): React.JSX.Element {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [profiles, setProfiles] = useState<BillingProfile[]>([])
  const [profileId, setProfileId] = useState('private')
  const [openId, setOpenId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const refresh = useCallback(
    () => window.api.invoices.list(patientId).then(setInvoices),
    [patientId]
  )
  useEffect(() => {
    refresh()
    window.api.settings.listProfiles().then(setProfiles)
  }, [refresh])

  const add = async (): Promise<void> => {
    try {
      setError('')
      const inv = await window.api.invoices.create(patientId, profileId)
      setOpenId(inv.id)
      await refresh()
    } catch (err) {
      setError(msg(err))
    }
  }

  return (
    <div className="max-w-3xl space-y-3">
      <div className="flex items-center gap-2">
        <select
          className="input w-auto!"
          value={profileId}
          onChange={(e) => setProfileId(e.target.value)}
        >
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button onClick={add} className="btn-primary">
          + New invoice
        </button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {invoices.length === 0 && <p className="text-sm text-slate-500">No invoices yet.</p>}
      {invoices.map((inv) => (
        <div key={inv.id}>
          <button
            onClick={() => setOpenId(openId === inv.id ? null : inv.id)}
            className="flex w-full cursor-pointer items-center gap-4 card px-4 py-3 text-left text-sm transition hover:bg-canvas"
          >
            <span className="w-24 font-medium">{inv.number ?? 'Draft'}</span>
            <span className="text-slate-500">{inv.issueDate}</span>
            <span className={`capitalize ${statusCls[inv.status]}`}>{inv.status}</span>
            <span className="ml-auto">{formatMoney(inv.totalCents)}</span>
          </button>
          {openId === inv.id && (
            <div className="mt-2">
              <InvoiceEditor
                key={`${inv.id}:${inv.updatedAt}`}
                invoice={inv}
                profiles={profiles}
                onChanged={refresh}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

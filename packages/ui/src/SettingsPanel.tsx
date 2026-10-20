import { useEffect, useState } from 'react'
import { SyncSettings } from './SyncPanel'
import {
  INVOICE_COLORS,
  INVOICE_FONTS,
  type InvoiceFontId,
  type PractitionerProfile
} from '@flowpt/shared'

const inputCls = 'input'
const msg = (err: unknown): string =>
  (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

const practitionerFields: { key: keyof PractitionerProfile; label: string }[] = [
  { key: 'name', label: 'Your name *' },
  { key: 'credentials', label: 'Credentials (e.g. RMT, R.Psych)' },
  { key: 'businessName', label: 'Business / clinic name' },
  { key: 'registrationNo', label: 'College registration #' },
  { key: 'gstNumber', label: 'GST/HST # (if registered)' },
  { key: 'address', label: 'Address' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' }
]

const FONT_PREVIEW: Record<InvoiceFontId, string> = {
  sans: "'Helvetica Neue', Helvetica, Arial, sans-serif",
  humanist: "'Avenir Next', 'Segoe UI', Calibri, 'Trebuchet MS', sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  elegant: "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif"
}

// Font + colour pickers with a live preview rendered by the same template as the PDF.
function InvoiceStyle({
  p,
  setP
}: {
  p: PractitionerProfile
  setP: (p: PractitionerProfile) => void
}): React.JSX.Element {
  const [html, setHtml] = useState('')
  const [previewError, setPreviewError] = useState('')
  useEffect(() => {
    const t = setTimeout(() => {
      window.api.settings
        .previewInvoice(p)
        .then((h) => {
          setPreviewError('')
          setHtml(h.replace('<style>', '<style>body{padding:28px 32px}'))
        })
        .catch((err) => setPreviewError(msg(err)))
    }, 250)
    return () => clearTimeout(t)
  }, [p])

  return (
    <div className="space-y-3 pt-2">
      <h2 className="section-title">Invoice style</h2>
      <div className="grid grid-cols-2 gap-2">
        {INVOICE_FONTS.map((f) => (
          <button
            type="button"
            key={f.id}
            onClick={() => setP({ ...p, invoiceFont: f.id })}
            className={`cursor-pointer rounded-lg border px-3 py-2 text-left transition ${
              p.invoiceFont === f.id
                ? 'border-brand-800 bg-brand-50'
                : 'border-line hover:border-brand-200'
            }`}
          >
            <span
              className="block text-lg leading-tight"
              style={{ fontFamily: FONT_PREVIEW[f.id] }}
            >
              Aa Invoice
            </span>
            <span className="text-xs text-slate-500">{f.label}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {INVOICE_COLORS.map((c) => (
          <button
            type="button"
            key={c.value}
            title={c.label}
            aria-label={c.label}
            onClick={() => setP({ ...p, invoiceColor: c.value })}
            className={`size-8 cursor-pointer rounded-full border-2 transition ${
              p.invoiceColor === c.value ? 'border-ink' : 'border-transparent'
            }`}
            style={{ background: c.value }}
          />
        ))}
        <label className="ml-1 flex cursor-pointer items-center gap-2 text-sm text-slate-600">
          <input
            type="color"
            value={p.invoiceColor}
            onChange={(e) => setP({ ...p, invoiceColor: e.target.value })}
            className="size-8 cursor-pointer rounded border border-line bg-transparent p-0.5"
          />
          Custom
        </label>
      </div>
      <div className="h-[490px] overflow-hidden rounded-lg border border-line bg-white">
        {previewError && (
          <p className="p-4 text-sm text-red-600">Preview unavailable: {previewError}</p>
        )}
        <iframe
          title="Invoice preview"
          sandbox=""
          srcDoc={html}
          className="h-[600px] w-[700px] origin-top-left scale-[0.8] border-0"
        />
      </div>
    </div>
  )
}

function PractitionerForm(): React.JSX.Element {
  const [p, setP] = useState<PractitionerProfile | null>(null)
  const [status, setStatus] = useState('')
  useEffect(() => {
    window.api.settings.getPractitioner().then(setP)
  }, [])
  if (!p) return <div />

  const save = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    try {
      setP(await window.api.settings.savePractitioner(p))
      setStatus('Saved')
    } catch (err) {
      setStatus(msg(err))
    }
  }

  return (
    <form onSubmit={save} className="max-w-xl space-y-3">
      <h2 className="section-title">Practitioner details</h2>
      <p className="text-sm text-slate-500">Printed on your invoices.</p>
      {practitionerFields.map((f) => (
        <label key={f.key} className="block text-sm">
          <span className="field-label">{f.label}</span>
          <input
            className={inputCls}
            value={p[f.key]}
            onChange={(e) => setP({ ...p, [f.key]: e.target.value })}
          />
        </label>
      ))}
      <InvoiceStyle p={p} setP={setP} />
      <div className="flex items-center gap-3">
        <button className="btn-primary">Save</button>
        <span className="text-sm text-slate-500">{status}</span>
      </div>
    </form>
  )
}

function BackupSettings(): React.JSX.Element {
  const [passphrase, setPassphrase] = useState('')
  const [confirm, setConfirm] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  const describe = (counts?: Record<string, number>): string =>
    counts
      ? ` (${counts.patients} patients, ${counts.chart_notes} notes, ${counts.invoices} invoices)`
      : ''

  const run = async (
    kind: 'export' | 'restore',
    fn: () => Promise<{ saved: boolean; path?: string; counts?: Record<string, number> }>
  ): Promise<void> => {
    setBusy(true)
    setStatus(kind === 'export' ? 'Encrypting…' : 'Restoring…')
    try {
      const res = await fn()
      setStatus(
        res.saved
          ? `${kind === 'export' ? 'Backup saved' : 'Restored'}${describe(res.counts)}`
          : 'Cancelled'
      )
      if (res.saved && kind === 'restore') window.location.reload()
    } catch (err) {
      setStatus(msg(err))
    } finally {
      setBusy(false)
    }
  }

  const exportIt = (): void => {
    if (passphrase !== confirm) return setStatus('Backup passphrases do not match')
    void run('export', () => window.api.backup!.exportTo(passphrase))
  }
  const restoreIt = (): void => {
    if (!window.confirm('Restore from a backup file? Only possible on a fresh install.')) return
    void run('restore', () => window.api.backup!.restoreFrom(passphrase))
  }

  return (
    <div className="max-w-xl space-y-3">
      <h2 className="section-title">Backup &amp; restore</h2>
      <p className="text-sm text-slate-500">
        Backups are encrypted with a backup passphrase (separate from your account password) and can
        be restored on any computer. Without the passphrase the file cannot be opened, and it cannot
        be recovered. Restore only works on a fresh install with no patient data.
      </p>
      <input
        className={inputCls}
        type="password"
        placeholder="Backup passphrase (8+ characters)"
        value={passphrase}
        onChange={(e) => setPassphrase(e.target.value)}
      />
      <input
        className={inputCls}
        type="password"
        placeholder="Confirm backup passphrase (export only)"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
      />
      <div className="flex items-center gap-2">
        <button disabled={busy} onClick={exportIt} className="btn-primary">
          Export backup
        </button>
        <button disabled={busy} onClick={restoreIt} className="btn-secondary">
          Restore from file
        </button>
        <span className="text-sm text-slate-500">{status}</span>
      </div>
    </div>
  )
}

export function SettingsPanel(): React.JSX.Element {
  return (
    <div className="space-y-10">
      <SyncSettings />
      {window.api.backup && <BackupSettings />}
      <PractitionerForm />
    </div>
  )
}

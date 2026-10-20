import { useEffect, useState } from 'react'
import { SyncSettings } from './SyncPanel'
import { type PractitionerProfile } from '@flowpt/shared'

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
    void run('export', () => window.api.backup.exportTo(passphrase))
  }
  const restoreIt = (): void => {
    if (!window.confirm('Restore from a backup file? Only possible on a fresh install.')) return
    void run('restore', () => window.api.backup.restoreFrom(passphrase))
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
      <BackupSettings />
      <PractitionerForm />
    </div>
  )
}

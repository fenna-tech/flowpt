import { useCallback, useEffect, useState } from 'react'
import { SyncSettings } from './SyncPanel'
import {
  LOCK_TIMEOUT_OPTIONS,
  type BillingProfile,
  type BillingProfileInput,
  type PractitionerProfile
} from '@flowpt/shared'

const inputCls = 'w-full rounded border border-slate-300 px-2 py-1.5 text-sm'
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

const emptyProfile: BillingProfileInput = {
  name: '',
  payerLabel: 'Insurer',
  requirePolicyNumber: false,
  requireServiceCode: false,
  defaultTaxPct: 0,
  footerNote: ''
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
      <h2 className="text-xl font-semibold">Practitioner details</h2>
      <p className="text-sm text-slate-500">Printed on your invoices.</p>
      {practitionerFields.map((f) => (
        <label key={f.key} className="block text-sm">
          <span className="mb-1 block text-slate-600">{f.label}</span>
          <input
            className={inputCls}
            value={p[f.key]}
            onChange={(e) => setP({ ...p, [f.key]: e.target.value })}
          />
        </label>
      ))}
      <div className="flex items-center gap-3">
        <button className="rounded bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700">
          Save
        </button>
        <span className="text-sm text-slate-500">{status}</span>
      </div>
    </form>
  )
}

function ProfilesManager(): React.JSX.Element {
  const [profiles, setProfiles] = useState<BillingProfile[]>([])
  const [editing, setEditing] = useState<BillingProfileInput | null>(null)
  const [error, setError] = useState('')
  const refresh = useCallback(() => window.api.settings.listProfiles().then(setProfiles), [])
  useEffect(() => {
    refresh()
  }, [refresh])

  const save = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    try {
      await window.api.settings.saveProfile(editing!)
      setEditing(null)
      setError('')
      await refresh()
    } catch (err) {
      setError(msg(err))
    }
  }

  const remove = async (id: string): Promise<void> => {
    if (!window.confirm('Remove this billing profile? Existing issued invoices are unaffected.'))
      return
    await window.api.settings.removeProfile(id)
    await refresh()
  }

  return (
    <div className="max-w-xl space-y-3">
      <h2 className="text-xl font-semibold">Billing profiles</h2>
      <p className="text-sm text-slate-500">
        Private pay is built in. Add a profile for each insurer or program you bill, with the fields
        it requires.
      </p>
      <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
        {profiles.map((p) => (
          <li key={p.id} className="flex items-center gap-2 px-3 py-2 text-sm">
            <span className="flex-1">{p.name}</span>
            {p.builtin ? (
              <span className="text-xs text-slate-400">built in</span>
            ) : (
              <>
                <button className="text-blue-600 hover:underline" onClick={() => setEditing(p)}>
                  Edit
                </button>
                <button className="text-red-600 hover:underline" onClick={() => remove(p.id)}>
                  Remove
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      {!editing && (
        <button
          onClick={() => setEditing(emptyProfile)}
          className="rounded bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700"
        >
          + Add profile
        </button>
      )}
      {editing && (
        <form onSubmit={save} className="space-y-3 rounded border border-slate-200 bg-white p-4">
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Profile name (e.g. Sun Life claims)</span>
            <input
              className={inputCls}
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">
              Payer label (e.g. Insurer, Program). Leave empty to bill the patient directly.
            </span>
            <input
              className={inputCls}
              value={editing.payerLabel}
              onChange={(e) => setEditing({ ...editing, payerLabel: e.target.value })}
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={editing.requirePolicyNumber}
              onChange={(e) => setEditing({ ...editing, requirePolicyNumber: e.target.checked })}
            />
            Require policy / claim number
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={editing.requireServiceCode}
              onChange={(e) => setEditing({ ...editing, requireServiceCode: e.target.checked })}
            />
            Require a service code on every line
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Default tax %</span>
            <input
              className={inputCls}
              inputMode="decimal"
              value={editing.defaultTaxPct}
              onChange={(e) =>
                setEditing({ ...editing, defaultTaxPct: Number(e.target.value) || 0 })
              }
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">
              Footer text (payment terms, claim instructions)
            </span>
            <textarea
              className={inputCls}
              rows={3}
              value={editing.footerNote}
              onChange={(e) => setEditing({ ...editing, footerNote: e.target.value })}
            />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button className="rounded bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700">
              Save profile
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(null)
                setError('')
              }}
              className="rounded border border-slate-300 px-4 py-1.5 text-sm"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

function SecuritySettings(): React.JSX.Element {
  const [timeout, setTimeoutMin] = useState<number | null>(null)
  const [oldPin, setOldPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [status, setStatus] = useState('')
  useEffect(() => {
    window.api.lock.getTimeout().then(setTimeoutMin)
  }, [])

  const changeTimeout = async (minutes: number): Promise<void> => {
    await window.api.lock.setTimeout(minutes)
    setTimeoutMin(minutes)
  }

  const changePin = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    try {
      await window.api.lock.changePin(oldPin, newPin)
      setOldPin('')
      setNewPin('')
      setStatus('PIN changed')
    } catch (err) {
      setStatus(msg(err))
    }
  }

  return (
    <div className="max-w-xl space-y-3">
      <h2 className="text-xl font-semibold">Security</h2>
      <label className="block text-sm">
        <span className="mb-1 block text-slate-600">Auto-lock after inactivity</span>
        <select
          className={inputCls}
          value={timeout ?? ''}
          onChange={(e) => changeTimeout(Number(e.target.value))}
        >
          {LOCK_TIMEOUT_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {m} minute{m === 1 ? '' : 's'}
            </option>
          ))}
        </select>
      </label>
      <form onSubmit={changePin} className="space-y-2">
        <input
          className={inputCls}
          type="password"
          placeholder="Current PIN"
          value={oldPin}
          onChange={(e) => setOldPin(e.target.value)}
        />
        <input
          className={inputCls}
          type="password"
          placeholder="New PIN (6+ characters)"
          value={newPin}
          onChange={(e) => setNewPin(e.target.value)}
        />
        <div className="flex items-center gap-3">
          <button className="rounded bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700">
            Change PIN
          </button>
          <span className="text-sm text-slate-500">{status}</span>
        </div>
      </form>
    </div>
  )
}

function BackupSettings(): React.JSX.Element {
  const [pin, setPin] = useState('')
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
    void run('export', () => window.api.backup.exportTo(pin, passphrase))
  }
  const restoreIt = (): void => {
    if (!window.confirm('Restore from a backup file? Only possible on a fresh install.')) return
    void run('restore', () => window.api.backup.restoreFrom(pin, passphrase))
  }

  return (
    <div className="max-w-xl space-y-3">
      <h2 className="text-xl font-semibold">Backup &amp; restore</h2>
      <p className="text-sm text-slate-500">
        Backups are encrypted with a backup passphrase (separate from your PIN) and can be restored
        on any computer. Without the passphrase the file cannot be opened, and it cannot be
        recovered. Restore only works on a fresh install with no patient data.
      </p>
      <input
        className={inputCls}
        type="password"
        placeholder="Your app PIN (to confirm)"
        value={pin}
        onChange={(e) => setPin(e.target.value)}
      />
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
        <button
          disabled={busy}
          onClick={exportIt}
          className="rounded bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-40"
        >
          Export backup
        </button>
        <button
          disabled={busy}
          onClick={restoreIt}
          className="rounded border border-slate-300 px-4 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-40"
        >
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
      <SecuritySettings />
      <SyncSettings />
      <BackupSettings />
      <PractitionerForm />
      <ProfilesManager />
    </div>
  )
}

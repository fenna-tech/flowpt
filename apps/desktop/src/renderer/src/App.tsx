import { useCallback, useEffect, useState } from 'react'
import type { Patient, PatientInput } from '@flowpt/shared'
import { NotesPanel } from './NotesPanel'
import { AuditPanel } from './AuditPanel'
import { InvoicesPanel } from './InvoicesPanel'
import { SettingsPanel } from './SettingsPanel'
import { Dashboard } from './Dashboard'
import { SyncBadge } from './SyncPanel'
import { CloudOnboarding } from './CloudOnboarding'
import { useSyncStatus } from './syncHooks'
import { LockScreen } from './LockScreen'
import {
  ChevronLeftIcon,
  HomeIcon,
  LockIcon,
  LogoMark,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  UsersIcon
} from './Icons'
import { useActivityPings, useLockStatus } from './lockHooks'

const empty: PatientInput = {
  firstName: '',
  lastName: '',
  dob: '',
  phn: '',
  email: '',
  phone: '',
  address: '',
  notes: ''
}

const fields: { key: keyof PatientInput; label: string; type?: string }[] = [
  { key: 'firstName', label: 'First name' },
  { key: 'lastName', label: 'Last name' },
  { key: 'dob', label: 'Date of birth', type: 'date' },
  { key: 'phn', label: 'BC PHN (10 digits)' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'phone', label: 'Phone', type: 'tel' },
  { key: 'address', label: 'Address' }
]

const inputCls = 'input'

function Workspace(): React.JSX.Element {
  const [patients, setPatients] = useState<Patient[]>([])
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | 'new' | null>(null)
  const [form, setForm] = useState<PatientInput>(empty)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'details' | 'notes' | 'invoices' | 'audit'>('details')
  const [view, setView] = useState<'dashboard' | 'patients' | 'settings'>('dashboard')

  const [practitioner, setPractitioner] = useState({ name: '' })
  useEffect(() => {
    window.api.settings.getPractitioner().then(setPractitioner)
  }, [])

  const refresh = useCallback(() => window.api.patients.list(search).then(setPatients), [search])
  useEffect(() => {
    refresh()
  }, [refresh])

  const select = (p: Patient | null): void => {
    setError('')
    setTab('details')
    setView('patients')
    if (p) {
      const { firstName, lastName, dob, phn, email, phone, address, notes } = p
      setForm({ firstName, lastName, dob, phn, email, phone, address, notes })
      setSelectedId(p.id)
    } else {
      setForm(empty)
      setSelectedId('new')
    }
  }

  const openPatientInvoices = async (patientId: string): Promise<void> => {
    const p = await window.api.patients.get(patientId)
    if (!p) return
    select(p)
    setTab('invoices')
  }

  const save = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setError('')
    try {
      const saved =
        selectedId === 'new'
          ? await window.api.patients.create(form)
          : await window.api.patients.update(selectedId as string, form)
      setSelectedId(saved.id)
      await refresh()
    } catch (err) {
      setError(
        (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      )
    }
  }

  const remove = async (): Promise<void> => {
    if (!selectedId || selectedId === 'new') return
    if (!window.confirm('Delete this patient?')) return
    await window.api.patients.remove(selectedId)
    setSelectedId(null)
    await refresh()
  }

  const nav = (
    id: 'dashboard' | 'patients' | 'settings',
    label: string,
    icon: React.JSX.Element,
    onClick: () => void
  ): React.JSX.Element => {
    const active = view === id
    return (
      <button
        onClick={onClick}
        className={`relative flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[15px] transition ${
          active ? 'font-medium text-ink' : 'text-slate-600 hover:bg-white hover:text-ink'
        }`}
      >
        {active && <span className="absolute top-2 -left-5 h-6 w-1 rounded-r bg-brand-800" />}
        {icon}
        <span className="flex-1">{label}</span>
      </button>
    )
  }

  const selectedPatient = patients.find((p) => p.id === selectedId)
  const initials = practitioner.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('')

  return (
    <div className="flex h-screen bg-surface text-ink">
      <aside className="flex w-64 shrink-0 flex-col border-r border-line bg-canvas px-5 py-6">
        <div className="mb-8 flex items-center gap-3 px-1">
          <LogoMark />
          <span className="text-xl font-semibold tracking-tight">FlowPT</span>
        </div>

        <div className="mb-2 px-3 text-xs font-medium tracking-wider text-slate-400 uppercase">
          Menu
        </div>
        <nav className="space-y-1">
          {nav('dashboard', 'Dashboard', <HomeIcon />, () => setView('dashboard'))}
          {nav('patients', 'Patients', <UsersIcon />, () => {
            setView('patients')
            setSelectedId(null)
          })}
        </nav>

        <div className="mt-8 mb-2 border-t border-line px-3 pt-6 text-xs font-medium tracking-wider text-slate-400 uppercase">
          Account
        </div>
        <nav className="space-y-1">
          {nav('settings', 'Settings', <SettingsIcon />, () => setView('settings'))}
          <button
            onClick={() => window.api.lock.lock()}
            className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[15px] text-slate-600 transition hover:bg-white hover:text-ink"
          >
            <LockIcon />
            Lock now
          </button>
        </nav>

        <div className="mt-auto">
          <SyncBadge />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-line px-8 py-4">
          <div className="relative w-full max-w-sm">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-slate-500" />
            <input
              className="input-search"
              placeholder="Search patients by name or PHN…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setView('patients')
                setSelectedId(null)
              }}
            />
          </div>
          <div className="flex items-center gap-3 rounded-full bg-canvas py-1.5 pr-4 pl-1.5">
            <span className="grid size-8 place-items-center rounded-full bg-brand-800 text-xs font-semibold text-white">
              {initials || 'PT'}
            </span>
            <span className="text-sm font-medium">{practitioner.name || 'Practitioner'}</span>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-8 py-8">
          {view === 'dashboard' ? (
            <Dashboard onOpenInvoice={openPatientInvoices} />
          ) : view === 'settings' ? (
            <SettingsPanel />
          ) : selectedId === null ? (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="page-title">Patients</h2>
                <button className="btn-primary" onClick={() => select(null)}>
                  <PlusIcon className="size-4" /> New patient
                </button>
              </div>
              {patients.length === 0 ? (
                <p className="subtle">
                  {search ? 'No patients match your search.' : 'No patients yet.'}
                </p>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead className="table-head">
                    <tr>
                      <th className="rounded-l-lg px-4 py-3 font-medium">Patient</th>
                      <th className="px-4 py-3 font-medium">Email</th>
                      <th className="px-4 py-3 font-medium">Phone</th>
                      <th className="px-4 py-3 font-medium">Date of birth</th>
                      <th className="rounded-r-lg px-4 py-3 font-medium">BC PHN</th>
                    </tr>
                  </thead>
                  <tbody>
                    {patients.map((p) => (
                      <tr
                        key={p.id}
                        onClick={() => select(p)}
                        className="table-row cursor-pointer transition hover:bg-canvas"
                      >
                        <td className="px-4 py-4 font-medium">
                          {p.lastName}, {p.firstName}
                        </td>
                        <td className="px-4 py-4 text-slate-600">{p.email || '—'}</td>
                        <td className="px-4 py-4 text-slate-600">{p.phone || '—'}</td>
                        <td className="px-4 py-4 text-slate-600">{p.dob || '—'}</td>
                        <td className="px-4 py-4 text-slate-600">{p.phn || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              <div>
                <button
                  onClick={() => setSelectedId(null)}
                  className="mb-3 inline-flex cursor-pointer items-center gap-1 text-sm text-muted transition hover:text-ink"
                >
                  <ChevronLeftIcon className="size-4" /> All patients
                </button>
                <h2 className="page-title">
                  {selectedId === 'new'
                    ? 'New patient'
                    : selectedPatient
                      ? `${selectedPatient.firstName} ${selectedPatient.lastName}`
                      : 'Patient'}
                </h2>
              </div>
              {selectedId !== 'new' && (
                <div className="flex gap-8 border-b border-line">
                  {(['details', 'notes', 'invoices', 'audit'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setTab(t)}
                      className={`-mb-px cursor-pointer border-b-2 pb-3 text-[15px] transition ${
                        tab === t
                          ? 'border-brand-800 font-medium text-ink'
                          : 'border-transparent text-slate-500 hover:text-ink'
                      }`}
                    >
                      {
                        {
                          details: 'Details',
                          notes: 'Chart notes',
                          invoices: 'Invoices',
                          audit: 'Audit log'
                        }[t]
                      }
                    </button>
                  ))}
                </div>
              )}
              {selectedId !== 'new' && tab === 'notes' ? (
                <NotesPanel key={selectedId} patientId={selectedId} />
              ) : selectedId !== 'new' && tab === 'invoices' ? (
                <InvoicesPanel key={selectedId} patientId={selectedId} />
              ) : selectedId !== 'new' && tab === 'audit' ? (
                <AuditPanel key={selectedId} patientId={selectedId} />
              ) : (
                <form onSubmit={save} className="card max-w-2xl space-y-4 p-6">
                  <div className="grid grid-cols-2 gap-4">
                    {fields.map((f) => (
                      <label key={f.key} className="block text-sm">
                        <span className="field-label">{f.label}</span>
                        <input
                          className={inputCls}
                          type={f.type ?? 'text'}
                          value={form[f.key]}
                          onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                        />
                      </label>
                    ))}
                  </div>
                  <label className="block text-sm">
                    <span className="field-label">General notes (not clinical)</span>
                    <textarea
                      className={inputCls}
                      rows={5}
                      value={form.notes}
                      onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    />
                  </label>
                  {error && <p className="text-sm text-red-600">{error}</p>}
                  <div className="flex gap-2">
                    <button className="btn-primary">Save</button>
                    {selectedId !== 'new' && (
                      <button type="button" onClick={remove} className="btn-danger">
                        Delete
                      </button>
                    )}
                  </div>
                </form>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

// First run: a managed build requires a cloud account (and MFA) before the workspace opens.
// After the device is linked, the workspace always opens, so offline use never depends on the network.
function Gate(): React.JSX.Element {
  const [sync, refresh] = useSyncStatus(2000)
  if (!sync) return <div />
  if (sync.managed && !sync.linked) return <CloudOnboarding status={sync} refresh={refresh} />
  return <Workspace />
}

// The workspace is unmounted while locked, so no patient data lingers in renderer state.
function App(): React.JSX.Element {
  const status = useLockStatus()
  useActivityPings(status === 'unlocked')
  if (status === null) return <div />
  if (status !== 'unlocked') return <LockScreen status={status} />
  return <Gate />
}

export default App

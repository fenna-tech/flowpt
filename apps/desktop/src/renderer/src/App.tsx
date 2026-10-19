import { useCallback, useEffect, useState } from 'react'
import type { Patient, PatientInput } from '@flowpt/shared'
import { NotesPanel } from './NotesPanel'

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

const inputCls = 'w-full rounded border border-slate-300 px-2 py-1.5 text-sm'

function App(): React.JSX.Element {
  const [patients, setPatients] = useState<Patient[]>([])
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | 'new' | null>(null)
  const [form, setForm] = useState<PatientInput>(empty)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'details' | 'notes'>('details')

  const refresh = useCallback(() => window.api.patients.list(search).then(setPatients), [search])
  useEffect(() => {
    refresh()
  }, [refresh])

  const select = (p: Patient | null): void => {
    setError('')
    setTab('details')
    if (p) {
      const { firstName, lastName, dob, phn, email, phone, address, notes } = p
      setForm({ firstName, lastName, dob, phn, email, phone, address, notes })
      setSelectedId(p.id)
    } else {
      setForm(empty)
      setSelectedId('new')
    }
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

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900">
      <aside className="flex w-72 flex-col border-r border-slate-200 bg-white">
        <div className="space-y-2 p-3">
          <h1 className="text-lg font-semibold">Patients</h1>
          <input
            className={inputCls}
            placeholder="Search name or PHN"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button
            className="w-full rounded bg-blue-600 py-1.5 text-sm text-white hover:bg-blue-700"
            onClick={() => select(null)}
          >
            + New patient
          </button>
        </div>
        <ul className="flex-1 overflow-y-auto">
          {patients.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => select(p)}
                className={`w-full px-3 py-2 text-left text-sm hover:bg-slate-100 ${
                  selectedId === p.id ? 'bg-blue-50' : ''
                }`}
              >
                {p.lastName}, {p.firstName}
              </button>
            </li>
          ))}
          {patients.length === 0 && (
            <li className="px-3 py-4 text-sm text-slate-500">No patients yet.</li>
          )}
        </ul>
      </aside>

      <main className="flex-1 overflow-y-auto p-6">
        {selectedId === null ? (
          <p className="text-slate-500">Select a patient or create a new one.</p>
        ) : (
          <>
            {selectedId !== 'new' && (
              <div className="mb-4 flex gap-1 border-b border-slate-200">
                {(['details', 'notes'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`px-4 py-2 text-sm capitalize ${
                      tab === t
                        ? 'border-b-2 border-blue-600 font-medium text-blue-700'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    {t === 'notes' ? 'Chart notes' : 'Details'}
                  </button>
                ))}
              </div>
            )}
            {selectedId !== 'new' && tab === 'notes' ? (
              <NotesPanel key={selectedId} patientId={selectedId} />
            ) : (
              <form onSubmit={save} className="max-w-xl space-y-3">
                <h2 className="text-xl font-semibold">
                  {selectedId === 'new' ? 'New patient' : 'Edit patient'}
                </h2>
                {fields.map((f) => (
                  <label key={f.key} className="block text-sm">
                    <span className="mb-1 block text-slate-600">{f.label}</span>
                    <input
                      className={inputCls}
                      type={f.type ?? 'text'}
                      value={form[f.key]}
                      onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                    />
                  </label>
                ))}
                <label className="block text-sm">
                  <span className="mb-1 block text-slate-600">General notes (not clinical)</span>
                  <textarea
                    className={inputCls}
                    rows={5}
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  />
                </label>
                {error && <p className="text-sm text-red-600">{error}</p>}
                <div className="flex gap-2">
                  <button className="rounded bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700">
                    Save
                  </button>
                  {selectedId !== 'new' && (
                    <button
                      type="button"
                      onClick={remove}
                      className="rounded border border-red-300 px-4 py-1.5 text-sm text-red-600 hover:bg-red-50"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </form>
            )}
          </>
        )}
      </main>
    </div>
  )
}

export default App

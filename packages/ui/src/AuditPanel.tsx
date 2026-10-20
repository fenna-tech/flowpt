import { useEffect, useState } from 'react'
import type { AuditEntry } from '@flowpt/shared'

export function AuditPanel({ patientId }: { patientId: string }): React.JSX.Element {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  useEffect(() => {
    window.api.audit.list(patientId).then(setEntries)
  }, [patientId])

  return (
    <div className="max-w-3xl">
      <p className="mb-3 text-sm text-slate-500">
        Append-only record of access and changes. It cannot be edited or deleted.
      </p>
      <table className="w-full text-left text-sm">
        <thead className="table-head">
          <tr>
            <th className="rounded-l-lg px-3 py-2.5 font-medium">When</th>
            <th className="px-3 py-2.5 font-medium">Who</th>
            <th className="px-3 py-2.5 font-medium">Action</th>
            <th className="rounded-r-lg px-3 py-2.5 font-medium">Detail</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className="table-row">
              <td className="px-3 py-3 whitespace-nowrap">{new Date(e.ts).toLocaleString()}</td>
              <td className="px-3 py-3">{e.actor}</td>
              <td className="px-3 py-3 font-mono text-xs">{e.action}</td>
              <td className="px-3 py-3 text-slate-600">{e.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

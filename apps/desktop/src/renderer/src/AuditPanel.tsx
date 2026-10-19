import { useEffect, useState } from 'react'
import type { AuditEntry } from '@flowpt/shared'

export function AuditPanel({ patientId }: { patientId: string }): React.JSX.Element {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  useEffect(() => {
    window.api.audit.list(patientId).then(setEntries)
  }, [patientId])

  return (
    <div className="max-w-2xl">
      <p className="mb-3 text-sm text-slate-500">
        Append-only record of access and changes. It cannot be edited or deleted.
      </p>
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-slate-500">
          <tr>
            <th className="py-1 pr-3">When</th>
            <th className="py-1 pr-3">Who</th>
            <th className="py-1 pr-3">Action</th>
            <th className="py-1">Detail</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className="border-t border-slate-200">
              <td className="py-1 pr-3 whitespace-nowrap">{new Date(e.ts).toLocaleString()}</td>
              <td className="py-1 pr-3">{e.actor}</td>
              <td className="py-1 pr-3 font-mono text-xs">{e.action}</td>
              <td className="py-1 text-slate-600">{e.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

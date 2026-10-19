import { BrowserWindow, dialog } from 'electron'
import { writeFile } from 'fs/promises'
import { formatMoney, lineTotalCents, type PractitionerProfile } from '@flowpt/shared'
import { getInvoice, getRow } from './db/invoices'
import { logAudit } from './db/audit'

interface Snapshot {
  practitioner: PractitionerProfile
  patient: { name: string; dob: string; phn: string; address: string; email: string }
  profile: { name: string; payerLabel: string; footerNote: string }
}

const esc = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  )
const nl = (s: string): string => esc(s).replace(/\n/g, '<br>')

function renderHtml(id: string): string {
  const inv = getInvoice(id)
  const snap = JSON.parse(getRow(id).snapshot!) as Snapshot
  const p = snap.practitioner
  const showCode = inv.items.some((i) => i.code)
  const insured = snap.profile.payerLabel !== ''
  const rows = inv.items
    .map(
      (i) => `<tr>
        <td>${esc(i.description)}</td>
        ${showCode ? `<td>${esc(i.code)}</td>` : ''}
        <td class="r">${i.quantity}</td>
        <td class="r">${formatMoney(i.unitCents)}</td>
        <td class="r">${formatMoney(lineTotalCents(i))}</td></tr>`
    )
    .join('')

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font:12px/1.5 Helvetica,Arial,sans-serif;color:#111;margin:0}
    h1{font-size:22px;margin:0 0 4px} .muted{color:#555}
    .head{display:flex;justify-content:space-between;margin-bottom:28px}
    table{width:100%;border-collapse:collapse;margin-top:18px}
    th{text-align:left;border-bottom:2px solid #333;padding:6px 4px;font-size:11px}
    td{padding:6px 4px;border-bottom:1px solid #ddd} .r{text-align:right}
    .totals{margin:14px 0 0 auto;width:260px} .totals div{display:flex;justify-content:space-between;padding:2px 0}
    .total{font-weight:bold;font-size:14px;border-top:2px solid #333;margin-top:4px;padding-top:6px!important}
    .stamp{display:inline-block;border:2px solid;padding:2px 10px;font-weight:bold;transform:rotate(-4deg)}
    .paid{color:#1a7f37} .void{color:#b42318} .foot{margin-top:30px;font-size:11px}
  </style></head><body>
  <div class="head">
    <div>
      <h1>${esc(p.businessName || p.name)}</h1>
      <div>${esc(p.name)}${p.credentials ? ', ' + esc(p.credentials) : ''}</div>
      ${p.registrationNo ? `<div class="muted">Reg. # ${esc(p.registrationNo)}</div>` : ''}
      <div class="muted">${nl(p.address)}</div>
      <div class="muted">${esc([p.phone, p.email].filter(Boolean).join(' · '))}</div>
      ${p.gstNumber ? `<div class="muted">GST # ${esc(p.gstNumber)}</div>` : ''}
    </div>
    <div style="text-align:right">
      <h1>INVOICE</h1>
      <div><b>${esc(inv.number ?? '')}</b></div>
      <div class="muted">Date: ${esc(inv.issueDate)}</div>
      ${inv.status === 'paid' ? `<div class="stamp paid">PAID ${esc(inv.paidAt ?? '')}</div>` : ''}
      ${inv.status === 'void' ? '<div class="stamp void">VOID</div>' : ''}
    </div>
  </div>
  <div><b>Bill to</b><br>${esc(snap.patient.name)}<br>${nl(snap.patient.address)}
    ${insured && snap.patient.phn ? `<br>PHN: ${esc(snap.patient.phn)}` : ''}
    ${insured && snap.patient.dob ? `<br>DOB: ${esc(snap.patient.dob)}` : ''}</div>
  ${
    insured
      ? `<div style="margin-top:10px"><b>${esc(snap.profile.payerLabel)}</b>: ${esc(inv.payerName)}
         ${inv.policyNumber ? `<br>Policy / claim #: ${esc(inv.policyNumber)}` : ''}</div>`
      : ''
  }
  <table><thead><tr><th>Description</th>${showCode ? '<th>Code</th>' : ''}
    <th class="r">Qty</th><th class="r">Unit price</th><th class="r">Amount</th></tr></thead>
    <tbody>${rows}</tbody></table>
  <div class="totals">
    <div><span>Subtotal</span><span>${formatMoney(inv.subtotalCents)}</span></div>
    ${inv.taxPct > 0 ? `<div><span>Tax (${inv.taxPct}%)</span><span>${formatMoney(inv.taxCents)}</span></div>` : ''}
    <div class="total"><span>Total (CAD)</span><span>${formatMoney(inv.totalCents)}</span></div>
  </div>
  ${inv.notes ? `<div class="foot"><b>Notes</b><br>${nl(inv.notes)}</div>` : ''}
  ${snap.profile.footerNote ? `<div class="foot">${nl(snap.profile.footerNote)}</div>` : ''}
  </body></html>`
}

// Render in an isolated hidden window with JavaScript disabled; content is escaped, not trusted.
export async function renderInvoicePdf(id: string): Promise<Buffer> {
  const row = getRow(id)
  if (row.status === 'draft' || !row.snapshot) throw new Error('Issue the invoice before exporting')
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, javascript: false, contextIsolation: true }
  })
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(renderHtml(id)))
    return await win.webContents.printToPDF({
      pageSize: 'Letter',
      printBackground: true,
      margins: { top: 0.6, bottom: 0.6, left: 0.7, right: 0.7 } // inches
    })
  } finally {
    win.destroy()
  }
}

export async function exportInvoicePdf(id: string): Promise<{ saved: boolean; path?: string }> {
  const pdf = await renderInvoicePdf(id)
  const row = getRow(id)
  const snap = JSON.parse(row.snapshot!) as Snapshot
  const safe = `${row.number}-${snap.patient.name}`.replace(/[^\w.-]+/g, '_')
  const opts = {
    title: 'Save invoice PDF',
    defaultPath: `${safe}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  }
  const parent = BrowserWindow.getFocusedWindow()
  const res = parent ? await dialog.showSaveDialog(parent, opts) : await dialog.showSaveDialog(opts)
  if (res.canceled || !res.filePath) return { saved: false }
  await writeFile(res.filePath, pdf)
  logAudit('invoice.export', 'invoice', id, row.patient_id, row.number ?? '')
  return { saved: true, path: res.filePath }
}

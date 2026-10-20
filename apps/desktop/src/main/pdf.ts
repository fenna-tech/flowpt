import { BrowserWindow, dialog } from 'electron'
import { writeFile } from 'fs/promises'
import {
  buildIssuedInvoiceHtml,
  previewInvoiceHtml as sharedPreviewHtml,
  type InvoiceSnapshot,
  type PractitionerProfile
} from '@flowpt/shared'
import { getInvoice, getRow } from './db/invoices'
import { getPractitioner } from './db/settings'
import { logAudit } from './db/audit'

// Issued invoices keep the practitioner details they were issued with; the look (font, colour) is
// the current setting, so changing the theme restyles past invoices when they are exported again.
function renderHtml(id: string): string {
  const snap = JSON.parse(getRow(id).snapshot!) as InvoiceSnapshot
  return buildIssuedInvoiceHtml(snap, getInvoice(id), getPractitioner())
}

// Sample invoice for the live preview in Settings (uses the unsaved form values).
export const previewInvoiceHtml = (draft: PractitionerProfile): string =>
  sharedPreviewHtml({ ...getPractitioner(), ...draft })

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
  const snap = JSON.parse(row.snapshot!) as InvoiceSnapshot
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

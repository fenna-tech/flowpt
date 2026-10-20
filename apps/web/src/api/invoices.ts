import {
  assertIssuable,
  buildIssuedInvoiceHtml,
  buildSnapshot,
  cleanInvoiceInput,
  cleanPayment,
  computeTotals,
  findBillingProfile,
  todayLocal,
  type Invoice,
  type InvoiceApi,
  type InvoiceSnapshot,
  type InvoiceStatus,
  type LineItem
} from '@flowpt/shared'
import { audit, check, deviceId, nowIso, supabase } from './core'
import { getPatient } from './patients'
import { getPractitioner } from './settings'
import { printHtml } from './print'

interface Row {
  id: string
  number: string | null
  patient_id: string
  profile_id: string
  status: InvoiceStatus
  issue_date: string
  payer_name: string
  policy_number: string
  items: LineItem[]
  tax_pct: number | string
  notes: string
  snapshot: InvoiceSnapshot | null
  paid_at: string | null
  payment_method: string
  created_at: string
  updated_at: string
}

const toInvoice = (r: Row): Invoice => {
  const taxPct = Number(r.tax_pct)
  return {
    id: r.id,
    number: r.number,
    patientId: r.patient_id,
    profileId: r.profile_id,
    status: r.status,
    issueDate: r.issue_date,
    payerName: r.payer_name,
    policyNumber: r.policy_number,
    items: r.items,
    taxPct,
    notes: r.notes,
    ...computeTotals(r.items, taxPct),
    paidAt: r.paid_at,
    paymentMethod: r.payment_method,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

async function getRow(id: string): Promise<Row> {
  const r = check(
    await supabase.from('invoices').select('*').eq('id', id).is('deleted_at', null).maybeSingle()
  ) as Row | null
  if (!r) throw new Error('Invoice not found')
  return r
}

// Updates are conditional on the status we validated against, and the server ignores stale writes,
// so an empty result means the invoice changed underneath us.
async function patch(
  id: string,
  from: InvoiceStatus,
  changes: Record<string, unknown>
): Promise<Invoice> {
  const rows = check(
    await supabase
      .from('invoices')
      .update({ ...changes, updated_at: nowIso() })
      .eq('id', id)
      .eq('status', from)
      .select()
  ) as Row[]
  if (rows.length === 0) throw new Error('Not saved: the invoice changed. Reload and retry.')
  return toInvoice(rows[0])
}

// Reserve the next invoice number for this browser's device. The web app is online-only, so it
// leases one number at a time (no unused blocks, no gaps from this client).
async function leaseNumber(): Promise<string> {
  const { data, error } = await supabase.rpc('lease_invoice_numbers', {
    p_device: await deviceId(),
    p_count: 1,
    p_min_start: 1
  })
  if (error) throw new Error(error.message)
  const block = (data as { start_no: number }[] | null)?.[0]
  if (!block) throw new Error('Could not reserve an invoice number')
  return `INV-${String(block.start_no).padStart(4, '0')}`
}

export const invoices: InvoiceApi = {
  async list(patientId) {
    const rows = check(
      await supabase
        .from('invoices')
        .select('*')
        .eq('patient_id', patientId)
        .is('deleted_at', null)
        .order('issue_date', { ascending: false })
        .order('created_at', { ascending: false })
    ) as Row[]
    return rows.map(toInvoice)
  },

  async create(patientId, profileId) {
    if (!(await getPatient(patientId))) throw new Error('Patient not found')
    const profile = findBillingProfile(profileId)
    const id = crypto.randomUUID()
    const now = nowIso()
    const row = check(
      await supabase
        .from('invoices')
        .insert({
          id,
          patient_id: patientId,
          profile_id: profile.id,
          issue_date: todayLocal(),
          tax_pct: profile.defaultTaxPct,
          created_at: now,
          updated_at: now
        })
        .select()
        .single()
    ) as Row
    await audit('invoice.create', 'invoice', id, patientId, profile.id)
    return toInvoice(row)
  },

  async update(id, input) {
    const row = await getRow(id)
    if (row.status !== 'draft')
      throw new Error('Issued invoices cannot be edited. Void and recreate.')
    const c = cleanInvoiceInput(input)
    const inv = await patch(id, 'draft', {
      profile_id: c.profile.id,
      issue_date: c.issueDate,
      payer_name: c.payerName,
      policy_number: c.policyNumber,
      items: c.items,
      tax_pct: c.taxPct,
      notes: c.notes
    })
    await audit('invoice.update', 'invoice', id, row.patient_id)
    return inv
  },

  // Issuing assigns the next sequential number and freezes a snapshot for the PDF.
  async issue(id) {
    const row = await getRow(id)
    if (row.status !== 'draft') throw new Error('Invoice is already issued')
    const inv = toInvoice(row)
    const profile = findBillingProfile(row.profile_id)
    const practitioner = await getPractitioner()
    const patient = await getPatient(row.patient_id)
    if (!patient) throw new Error('Patient not found')
    assertIssuable(inv, profile, practitioner)

    const number = await leaseNumber()
    const issued = await patch(id, 'draft', {
      status: 'issued',
      number,
      snapshot: buildSnapshot(practitioner, patient, profile)
    })
    await audit('invoice.issue', 'invoice', id, row.patient_id, number)
    return issued
  },

  async markPaid(id, method, paidDate) {
    const row = await getRow(id)
    if (row.status !== 'issued') throw new Error('Only issued invoices can be marked paid')
    cleanPayment(method, paidDate)
    const inv = await patch(id, 'issued', {
      status: 'paid',
      paid_at: paidDate,
      payment_method: method
    })
    await audit('invoice.paid', 'invoice', id, row.patient_id, method)
    return inv
  },

  async void(id) {
    const row = await getRow(id)
    if (row.status === 'draft') throw new Error('Delete drafts instead of voiding them')
    if (row.status === 'void') throw new Error('Invoice is already void')
    const inv = await patch(id, row.status, { status: 'void' })
    await audit('invoice.void', 'invoice', id, row.patient_id, row.number ?? '')
    return inv
  },

  async remove(id) {
    const row = await getRow(id)
    if (row.status !== 'draft') throw new Error('Only drafts can be deleted; void issued invoices')
    const now = nowIso()
    check(await supabase.from('invoices').update({ deleted_at: now, updated_at: now }).eq('id', id))
    await audit('invoice.delete', 'invoice', id, row.patient_id)
  },

  // The browser has no silent save-to-disk: open the print dialog, where "Save as PDF" is built in.
  async exportPdf(id) {
    const row = await getRow(id)
    if (row.status === 'draft' || !row.snapshot)
      throw new Error('Issue the invoice before exporting')
    const html = buildIssuedInvoiceHtml(row.snapshot, toInvoice(row), await getPractitioner())
    await printHtml(html, `${row.number}-${row.snapshot.patient.name}`.replace(/[^\w.-]+/g, '_'))
    await audit('invoice.export', 'invoice', id, row.patient_id, row.number ?? '')
    return { saved: false }
  }
}

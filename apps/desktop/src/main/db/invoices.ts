import { randomUUID } from 'crypto'
import {
  assertIssuable,
  buildSnapshot,
  cleanInvoiceInput,
  cleanPayment,
  computeTotals,
  todayLocal,
  type Invoice,
  type InvoiceInput,
  type InvoiceStatus,
  type LineItem
} from '@flowpt/shared'
import { getDb } from './connection'
import { logAudit } from './audit'
import { getPatient } from './patients'
import { getPractitioner, getProfile, getSetting, setSetting } from './settings'
import { takeInvoiceNumber } from '../sync/engine'

interface Row {
  id: string
  number: string | null
  patient_id: string
  profile_id: string
  status: InvoiceStatus
  issue_date: string
  payer_name: string
  policy_number: string
  items: string
  tax_pct: number
  notes: string
  snapshot: string | null
  paid_at: string | null
  payment_method: string
  created_at: string
  updated_at: string
}

const toInvoice = (r: Row): Invoice => {
  const items = JSON.parse(r.items) as LineItem[]
  return {
    id: r.id,
    number: r.number,
    patientId: r.patient_id,
    profileId: r.profile_id,
    status: r.status,
    issueDate: r.issue_date,
    payerName: r.payer_name,
    policyNumber: r.policy_number,
    items,
    taxPct: r.tax_pct,
    notes: r.notes,
    ...computeTotals(items, r.tax_pct),
    paidAt: r.paid_at,
    paymentMethod: r.payment_method,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

export function getRow(id: string): Row {
  const r = getDb().prepare('SELECT * FROM invoices WHERE id = ? AND deleted_at IS NULL').get(id)
  if (!r) throw new Error('Invoice not found')
  return r as Row
}

export const getInvoice = (id: string): Invoice => toInvoice(getRow(id))

export function listInvoices(patientId: string): Invoice[] {
  return (
    getDb()
      .prepare(
        `SELECT * FROM invoices WHERE patient_id = ? AND deleted_at IS NULL
         ORDER BY issue_date DESC, created_at DESC`
      )
      .all(patientId) as Row[]
  ).map(toInvoice)
}

export function createInvoice(patientId: string, profileId: string): Invoice {
  if (!getPatient(patientId)) throw new Error('Patient not found')
  const profile = getProfile(profileId)
  const id = randomUUID()
  const now = new Date().toISOString()
  const db = getDb()
  db.transaction(() => {
    db.prepare(
      `INSERT INTO invoices (id, patient_id, profile_id, issue_date, tax_pct, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, patientId, profile.id, todayLocal(), profile.defaultTaxPct, now, now)
    logAudit('invoice.create', 'invoice', id, patientId, profile.id)
  })()
  return getInvoice(id)
}

export function updateInvoice(id: string, input: InvoiceInput): Invoice {
  const row = getRow(id)
  if (row.status !== 'draft')
    throw new Error('Issued invoices cannot be edited. Void and recreate.')
  const c = cleanInvoiceInput(input)
  const db = getDb()
  db.transaction(() => {
    db.prepare(
      `UPDATE invoices SET profile_id=?, issue_date=?, payer_name=?, policy_number=?, items=?,
       tax_pct=?, notes=?, updated_at=? WHERE id=? AND status='draft'`
    ).run(
      c.profile.id,
      c.issueDate,
      c.payerName,
      c.policyNumber,
      JSON.stringify(c.items),
      c.taxPct,
      c.notes,
      new Date().toISOString(),
      id
    )
    logAudit('invoice.update', 'invoice', id, row.patient_id)
  })()
  return getInvoice(id)
}

// Issuing assigns the next sequential number and freezes a snapshot for the PDF.
export function issueInvoice(id: string): Invoice {
  const row = getRow(id)
  if (row.status !== 'draft') throw new Error('Invoice is already issued')
  const inv = toInvoice(row)
  const profile = getProfile(row.profile_id)
  const practitioner = getPractitioner()
  const patient = getPatient(row.patient_id)
  if (!patient) throw new Error('Patient not found')

  assertIssuable(inv, profile, practitioner)

  const db = getDb()
  db.transaction(() => {
    let number = takeInvoiceNumber(db) // leased block once this device is linked to a cloud account
    if (!number) {
      const next = Number(getSetting('next_invoice_no') ?? '1')
      number = `INV-${String(next).padStart(4, '0')}`
      setSetting('next_invoice_no', String(next + 1))
    }
    const snapshot = buildSnapshot(practitioner, patient, profile)
    db.prepare(
      `UPDATE invoices SET status='issued', number=?, snapshot=?, updated_at=? WHERE id=?`
    ).run(number, JSON.stringify(snapshot), new Date().toISOString(), id)
    logAudit('invoice.issue', 'invoice', id, row.patient_id, number)
  })()
  return getInvoice(id)
}

export function markPaid(id: string, method: string, paidDate: string): Invoice {
  const row = getRow(id)
  if (row.status !== 'issued') throw new Error('Only issued invoices can be marked paid')
  cleanPayment(method, paidDate)
  const db = getDb()
  db.transaction(() => {
    db.prepare(
      `UPDATE invoices SET status='paid', paid_at=?, payment_method=?, updated_at=? WHERE id=?`
    ).run(paidDate, method, new Date().toISOString(), id)
    logAudit('invoice.paid', 'invoice', id, row.patient_id, method)
  })()
  return getInvoice(id)
}

export function voidInvoice(id: string): Invoice {
  const row = getRow(id)
  if (row.status === 'draft') throw new Error('Delete drafts instead of voiding them')
  if (row.status === 'void') throw new Error('Invoice is already void')
  const db = getDb()
  db.transaction(() => {
    db.prepare(`UPDATE invoices SET status='void', updated_at=? WHERE id=?`).run(
      new Date().toISOString(),
      id
    )
    logAudit('invoice.void', 'invoice', id, row.patient_id, row.number ?? '')
  })()
  return getInvoice(id)
}

export function deleteInvoice(id: string): void {
  const row = getRow(id)
  if (row.status !== 'draft') throw new Error('Only drafts can be deleted; void issued invoices')
  const now = new Date().toISOString()
  const db = getDb()
  db.transaction(() => {
    db.prepare('UPDATE invoices SET deleted_at=?, updated_at=? WHERE id=?').run(now, now, id)
    logAudit('invoice.delete', 'invoice', id, row.patient_id)
  })()
}

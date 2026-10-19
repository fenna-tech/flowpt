import { randomUUID } from 'crypto'
import {
  PAYMENT_METHODS,
  computeTotals,
  type Invoice,
  type InvoiceInput,
  type InvoiceStatus,
  type LineItem
} from '@flowpt/shared'
import { getDb } from './connection'
import { logAudit } from './audit'
import { getPatient } from './patients'
import { getPractitioner, getProfile, getSetting, setSetting } from './settings'

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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const str = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.trim().slice(0, max) : ''

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

// IPC input is untrusted: validate and normalize here.
function cleanItems(items: unknown): LineItem[] {
  if (!Array.isArray(items) || items.length > 100) throw new Error('Invalid line items')
  return items.map((i) => {
    const quantity = Number(i?.quantity)
    const unitCents = Number(i?.unitCents)
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 10000) {
      throw new Error('Quantity must be greater than zero')
    }
    if (!Number.isInteger(unitCents) || unitCents < 0 || unitCents > 1_000_000_000) {
      throw new Error('Invalid price')
    }
    return {
      description: str(i?.description, 300),
      code: str(i?.code, 30),
      quantity,
      unitCents
    }
  })
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
    ).run(
      id,
      patientId,
      profile.id,
      new Date().toLocaleDateString('en-CA'),
      profile.defaultTaxPct,
      now,
      now
    )
    logAudit('invoice.create', 'invoice', id, patientId, profile.id)
  })()
  return getInvoice(id)
}

export function updateInvoice(id: string, input: InvoiceInput): Invoice {
  const row = getRow(id)
  if (row.status !== 'draft')
    throw new Error('Issued invoices cannot be edited. Void and recreate.')
  const date = str(input?.issueDate, 10)
  if (!DATE_RE.test(date)) throw new Error('Invalid invoice date')
  const taxPct = Number(input?.taxPct)
  if (!Number.isFinite(taxPct) || taxPct < 0 || taxPct > 100) throw new Error('Invalid tax rate')
  const profile = getProfile(str(input?.profileId, 100))
  const items = cleanItems(input?.items)
  const db = getDb()
  db.transaction(() => {
    db.prepare(
      `UPDATE invoices SET profile_id=?, issue_date=?, payer_name=?, policy_number=?, items=?,
       tax_pct=?, notes=?, updated_at=? WHERE id=? AND status='draft'`
    ).run(
      profile.id,
      date,
      str(input?.payerName, 150),
      str(input?.policyNumber, 100),
      JSON.stringify(items),
      taxPct,
      str(input?.notes, 2000),
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

  if (!practitioner.name) throw new Error('Add your practitioner details in Settings first')
  if (inv.items.length === 0) throw new Error('Add at least one line item')
  if (inv.items.some((i) => !i.description)) throw new Error('Every line item needs a description')
  if (profile.payerLabel && !row.payer_name) {
    throw new Error(`${profile.payerLabel} name is required for ${profile.name}`)
  }
  if (profile.requirePolicyNumber && !row.policy_number)
    throw new Error('Policy number is required')
  if (profile.requireServiceCode && inv.items.some((i) => !i.code)) {
    throw new Error('A service code is required on every line for this profile')
  }

  const db = getDb()
  db.transaction(() => {
    const next = Number(getSetting('next_invoice_no') ?? '1')
    const number = `INV-${String(next).padStart(4, '0')}`
    setSetting('next_invoice_no', String(next + 1))
    const snapshot = {
      practitioner,
      patient: {
        name: `${patient.firstName} ${patient.lastName}`,
        dob: patient.dob,
        phn: patient.phn,
        address: patient.address,
        email: patient.email
      },
      profile: {
        name: profile.name,
        payerLabel: profile.payerLabel,
        footerNote: profile.footerNote
      }
    }
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
  if (!(PAYMENT_METHODS as readonly string[]).includes(method))
    throw new Error('Invalid payment method')
  if (!DATE_RE.test(paidDate)) throw new Error('Invalid payment date')
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

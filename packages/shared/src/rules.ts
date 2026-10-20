// Pure validation and business rules shared by every data layer (desktop SQLite, web Supabase).
// Input from the UI is untrusted: validate and normalize here before it reaches storage.
import {
  BILLING_PROFILES,
  DEFAULT_INVOICE_COLOR,
  INVOICE_FONTS,
  PAYMENT_METHODS,
  PRIVATE_PROFILE,
  type BillingProfile,
  type Invoice,
  type InvoiceInput,
  type InvoiceSnapshot,
  type LineItem,
  type NoteSection,
  type Patient,
  type PatientInput,
  type PractitionerProfile,
} from "./models";

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const str = (v: unknown, max = 2000): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

export const todayLocal = (): string => new Date().toLocaleDateString("en-CA");

export function cleanPatientInput(input: PatientInput): PatientInput {
  const out: PatientInput = {
    firstName: str(input?.firstName, 100),
    lastName: str(input?.lastName, 100),
    dob: str(input?.dob, 10),
    phn: str(input?.phn, 20).replace(/\D/g, ""),
    email: str(input?.email, 200),
    phone: str(input?.phone, 50),
    address: str(input?.address, 500),
    parentNames: str(input?.parentNames, 300),
    diagnosis: str(input?.diagnosis, 1000),
    notes: str(input?.notes, 10000),
  };
  if (!out.firstName || !out.lastName)
    throw new Error("First and last name are required");
  if (out.dob && !DATE_RE.test(out.dob))
    throw new Error("Invalid date of birth");
  if (out.phn && out.phn.length !== 10)
    throw new Error("BC PHN must be 10 digits");
  return out;
}

// Names of the fields that differ, for audit metadata (never the values).
export const changedPatientFields = (
  before: Patient,
  after: PatientInput,
): string[] =>
  (Object.keys(after) as (keyof PatientInput)[]).filter(
    (k) => after[k] !== before[k],
  );

export function matchesPatientSearch(p: Patient, search: string): boolean {
  const q = str(search, 100).toLowerCase();
  if (!q) return true;
  return (
    `${p.firstName} ${p.lastName}`.toLowerCase().includes(q) ||
    p.phn.toLowerCase().includes(q) ||
    p.parentNames.toLowerCase().includes(q)
  );
}

export function cleanSections(sections: unknown): NoteSection[] {
  if (!Array.isArray(sections) || sections.length > 50)
    throw new Error("Invalid note sections");
  return sections.map((s) => ({
    key: String(s?.key ?? "").slice(0, 50),
    label: String(s?.label ?? "").slice(0, 100),
    text: String(s?.text ?? "").slice(0, 50000),
  }));
}

export function cleanVisitDate(d: unknown): string {
  if (typeof d !== "string" || !DATE_RE.test(d))
    throw new Error("Invalid visit date");
  return d;
}

export function cleanAddendum(text: unknown): string {
  const body = typeof text === "string" ? text.trim().slice(0, 50000) : "";
  if (!body) throw new Error("Addendum text is required");
  return body;
}

export function cleanLineItems(items: unknown): LineItem[] {
  if (!Array.isArray(items) || items.length > 100)
    throw new Error("Invalid line items");
  return items.map((i) => {
    const quantity = Number(i?.quantity);
    const unitCents = Number(i?.unitCents);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 10000) {
      throw new Error("Quantity must be greater than zero");
    }
    if (
      !Number.isInteger(unitCents) ||
      unitCents < 0 ||
      unitCents > 1_000_000_000
    ) {
      throw new Error("Invalid price");
    }
    return {
      description: str(i?.description, 300),
      code: str(i?.code, 30),
      quantity,
      unitCents,
    };
  });
}

// Drafts that reference a retired profile fall back to private pay rather than failing.
export const findBillingProfile = (id: string): BillingProfile =>
  BILLING_PROFILES.find((p) => p.id === id) ?? PRIVATE_PROFILE;

export interface CleanInvoiceInput {
  profile: BillingProfile;
  issueDate: string;
  taxPct: number;
  items: LineItem[];
  payerName: string;
  policyNumber: string;
  notes: string;
}

export function cleanInvoiceInput(input: InvoiceInput): CleanInvoiceInput {
  const issueDate = str(input?.issueDate, 10);
  if (!DATE_RE.test(issueDate)) throw new Error("Invalid invoice date");
  const taxPct = Number(input?.taxPct);
  if (!Number.isFinite(taxPct) || taxPct < 0 || taxPct > 100)
    throw new Error("Invalid tax rate");
  return {
    profile: findBillingProfile(str(input?.profileId, 100)),
    issueDate,
    taxPct,
    items: cleanLineItems(input?.items),
    payerName: str(input?.payerName, 150),
    policyNumber: str(input?.policyNumber, 100),
    notes: str(input?.notes, 2000),
  };
}

export function cleanPayment(method: string, paidDate: string): void {
  if (!(PAYMENT_METHODS as readonly string[]).includes(method))
    throw new Error("Invalid payment method");
  if (!DATE_RE.test(paidDate)) throw new Error("Invalid payment date");
}

// Throws the first reason a draft cannot be issued yet.
export function assertIssuable(
  inv: Invoice,
  profile: BillingProfile,
  practitioner: PractitionerProfile,
): void {
  if (!practitioner.name)
    throw new Error("Add your practitioner details in Settings first");
  if (inv.items.length === 0) throw new Error("Add at least one line item");
  if (inv.items.some((i) => !i.description))
    throw new Error("Every line item needs a description");
  if (profile.payerLabel && !inv.payerName) {
    throw new Error(
      `${profile.payerLabel} name is required for ${profile.name}`,
    );
  }
  if (profile.requirePolicyNumber && !inv.policyNumber)
    throw new Error("Policy number is required");
  if (profile.requireServiceCode && inv.items.some((i) => !i.code)) {
    throw new Error(
      "A service code is required on every line for this profile",
    );
  }
}

// Frozen at issue time so the PDF keeps the details the invoice was issued with.
export function buildSnapshot(
  practitioner: PractitionerProfile,
  patient: Patient,
  profile: BillingProfile,
): InvoiceSnapshot {
  return {
    practitioner,
    patient: {
      name: `${patient.firstName} ${patient.lastName}`,
      dob: patient.dob,
      phn: patient.phn,
      address: patient.address,
      email: patient.email,
    },
    profile: {
      name: profile.name,
      payerLabel: profile.payerLabel,
      footerNote: profile.footerNote,
    },
  };
}

export const EMPTY_PRACTITIONER: PractitionerProfile = {
  name: "",
  credentials: "",
  businessName: "",
  registrationNo: "",
  gstNumber: "",
  address: "",
  phone: "",
  email: "",
  invoiceFont: "sans",
  invoiceColor: DEFAULT_INVOICE_COLOR,
};

export function cleanPractitioner(p: PractitionerProfile): PractitionerProfile {
  return {
    name: str(p?.name, 100),
    credentials: str(p?.credentials, 50),
    businessName: str(p?.businessName, 150),
    registrationNo: str(p?.registrationNo, 50),
    gstNumber: str(p?.gstNumber, 50),
    address: str(p?.address, 500),
    phone: str(p?.phone, 50),
    email: str(p?.email, 200),
    invoiceFont: INVOICE_FONTS.some((f) => f.id === p?.invoiceFont)
      ? p.invoiceFont
      : "sans",
    invoiceColor: /^#[0-9a-f]{6}$/i.test(p?.invoiceColor ?? "")
      ? p.invoiceColor.toLowerCase()
      : DEFAULT_INVOICE_COLOR,
  };
}

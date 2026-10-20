export interface Patient {
  id: string;
  firstName: string;
  lastName: string;
  dob: string; // YYYY-MM-DD
  phn: string; // BC Personal Health Number (10 digits, optional)
  email: string;
  phone: string;
  address: string;
  parentNames: string; // parent(s) / guardian(s)
  diagnosis: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export type PatientInput = Omit<Patient, "id" | "createdAt" | "updatedAt">;

export interface PatientApi {
  list(search?: string): Promise<Patient[]>;
  get(id: string): Promise<Patient | null>;
  create(input: PatientInput): Promise<Patient>;
  update(id: string, input: PatientInput): Promise<Patient>;
  remove(id: string): Promise<void>;
}

// ---- Chart notes ----

export interface NoteTemplate {
  id: string;
  name: string;
  sections: { key: string; label: string; hint?: string }[];
}

// Templates are data so custom/user-defined ones can be added later without code changes.
export const BUILTIN_TEMPLATES: NoteTemplate[] = [
  {
    id: "soap",
    name: "SOAP",
    sections: [
      {
        key: "s",
        label: "Subjective",
        hint: "Patient's reported symptoms and history",
      },
      {
        key: "o",
        label: "Objective",
        hint: "Observations, measurements, findings",
      },
      {
        key: "a",
        label: "Assessment",
        hint: "Clinical impression / diagnosis",
      },
      { key: "p", label: "Plan", hint: "Treatment, follow-up, referrals" },
    ],
  },
  {
    id: "dap",
    name: "DAP",
    sections: [
      { key: "d", label: "Data" },
      { key: "a", label: "Assessment" },
      { key: "p", label: "Plan" },
    ],
  },
  { id: "free", name: "Free text", sections: [{ key: "note", label: "Note" }] },
];

// Each section stores its own label so old notes stay readable if templates change.
export interface NoteSection {
  key: string;
  label: string;
  text: string;
}

// Added after signing; append-only. The original note can never change.
export interface Addendum {
  id: string;
  noteId: string;
  text: string;
  author: string;
  createdAt: string;
}

export interface ChartNote {
  id: string;
  patientId: string;
  templateId: string;
  visitDate: string; // YYYY-MM-DD
  sections: NoteSection[];
  signedAt: string | null; // once set, the note is locked
  signedBy: string | null;
  addenda: Addendum[];
  createdAt: string;
  updatedAt: string;
}

export interface NoteApi {
  list(patientId: string): Promise<ChartNote[]>;
  create(
    patientId: string,
    templateId: string,
    visitDate: string,
  ): Promise<ChartNote>;
  update(
    id: string,
    visitDate: string,
    sections: NoteSection[],
  ): Promise<ChartNote>;
  sign(id: string): Promise<ChartNote>;
  addAddendum(id: string, text: string): Promise<ChartNote>;
  remove(id: string): Promise<void>; // unsigned drafts only
}

// ---- Audit log (append-only; never contains clinical content) ----

export interface AuditEntry {
  id: number | string; // row id locally, uuid in the cloud
  ts: string;
  action: string; // e.g. 'note.sign', 'patient.update'
  entity: string;
  entityId: string;
  patientId: string | null;
  actor: string; // practitioner identity at the time
  detail: string; // metadata only, e.g. changed field names
}

export interface AuditApi {
  list(patientId: string): Promise<AuditEntry[]>;
}

// ---- Billing ----

export interface PractitionerProfile {
  name: string;
  credentials: string; // e.g. "RMT", "R.Psych"
  businessName: string;
  registrationNo: string; // college registration number
  gstNumber: string;
  address: string;
  phone: string;
  email: string;
  invoiceFont: InvoiceFontId;
  invoiceColor: string; // accent colour for invoice PDFs, #rrggbb
}

export const INVOICE_FONTS = [
  { id: "sans", label: "Modern sans" },
  { id: "humanist", label: "Friendly sans" },
  { id: "serif", label: "Classic serif" },
  { id: "elegant", label: "Elegant serif" },
] as const;
export type InvoiceFontId = (typeof INVOICE_FONTS)[number]["id"];

export const INVOICE_COLORS = [
  { label: "Forest", value: "#0a3d34" },
  { label: "Ocean", value: "#0b4f8a" },
  { label: "Plum", value: "#6b2d5c" },
  { label: "Sunset", value: "#c2410c" },
  { label: "Rose", value: "#be185d" },
  { label: "Slate", value: "#334155" },
] as const;
export const DEFAULT_INVOICE_COLOR = INVOICE_COLORS[0].value;

// Funding types: a fixed set of billing profiles. Programs bill a named payer, private pay bills the patient.
export interface BillingProfile {
  id: string;
  name: string;
  builtin: boolean;
  payerLabel: string; // '' = billed directly to the patient; otherwise e.g. "Insurer" / "Program"
  requirePolicyNumber: boolean;
  requireServiceCode: boolean;
  defaultTaxPct: number;
  footerNote: string; // payment terms / claim instructions printed on the PDF
}

const profile = (
  id: string,
  name: string,
  payerLabel: string,
): BillingProfile => ({
  id,
  name,
  builtin: true,
  payerLabel,
  requirePolicyNumber: false,
  requireServiceCode: false,
  defaultTaxPct: 0,
  footerNote: "",
});

export const PRIVATE_PROFILE = profile(
  "private",
  "Private pay (patient pay and extended health)",
  "",
);
export const AHP_PROFILE = profile(
  "ahp",
  "At Home Program School Age Extended Therapies (AHP)",
  "Program",
);
export const AF_PROFILE = profile("af", "Autism Funding (AF)", "Program");
export const BILLING_PROFILES: BillingProfile[] = [
  PRIVATE_PROFILE,
  AHP_PROFILE,
  AF_PROFILE,
];

export interface LineItem {
  description: string;
  code: string; // service / fee code, optional unless the profile requires it
  quantity: number;
  unitCents: number;
}

export type InvoiceStatus = "draft" | "issued" | "paid" | "void";
export const PAYMENT_METHODS = [
  "cash",
  "etransfer",
  "card",
  "cheque",
  "insurer",
  "other",
] as const;

export interface Invoice {
  id: string;
  number: string | null; // assigned when issued
  patientId: string;
  profileId: string;
  status: InvoiceStatus;
  issueDate: string;
  payerName: string;
  policyNumber: string;
  items: LineItem[];
  taxPct: number;
  notes: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  paidAt: string | null;
  paymentMethod: string;
  createdAt: string;
  updatedAt: string;
}

// Frozen when an invoice is issued, so the printed invoice keeps the details it was issued with.
export interface InvoiceSnapshot {
  practitioner: PractitionerProfile;
  patient: {
    name: string;
    dob: string;
    phn: string;
    address: string;
    email: string;
  };
  profile: { name: string; payerLabel: string; footerNote: string };
}

export interface InvoiceInput {
  profileId: string;
  issueDate: string;
  payerName: string;
  policyNumber: string;
  items: LineItem[];
  taxPct: number;
  notes: string;
}

export const lineTotalCents = (i: LineItem): number =>
  Math.round(i.quantity * i.unitCents);

export function computeTotals(
  items: LineItem[],
  taxPct: number,
): { subtotalCents: number; taxCents: number; totalCents: number } {
  const subtotalCents = items.reduce((sum, i) => sum + lineTotalCents(i), 0);
  const taxCents = Math.round((subtotalCents * taxPct) / 100);
  return { subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
}

export const formatMoney = (cents: number): string =>
  new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(
    cents / 100,
  );

export interface InvoiceApi {
  list(patientId: string): Promise<Invoice[]>;
  create(patientId: string, profileId: string): Promise<Invoice>;
  update(id: string, input: InvoiceInput): Promise<Invoice>;
  issue(id: string): Promise<Invoice>;
  markPaid(id: string, method: string, paidDate: string): Promise<Invoice>;
  void(id: string): Promise<Invoice>;
  remove(id: string): Promise<void>; // drafts only
  exportPdf(id: string): Promise<{ saved: boolean; path?: string }>;
}

export interface SettingsApi {
  previewInvoice(p: PractitionerProfile): Promise<string>;
  getPractitioner(): Promise<PractitionerProfile>;
  savePractitioner(p: PractitionerProfile): Promise<PractitionerProfile>;
  listProfiles(): Promise<BillingProfile[]>;
}

// ---- Dashboard ----

export interface OutstandingInvoice {
  id: string;
  number: string;
  patientId: string;
  patientName: string;
  issueDate: string;
  totalCents: number;
  daysOutstanding: number;
}

export interface MonthlyRevenue {
  month: string; // YYYY-MM
  invoicedCents: number; // by invoice date (issued + paid)
  collectedCents: number; // by payment date (paid)
}

export interface DashboardData {
  outstanding: OutstandingInvoice[];
  outstandingCents: number;
  over30Count: number;
  collectedThisMonthCents: number;
  collectedYtdCents: number;
  invoicedYtdCents: number;
  months: MonthlyRevenue[]; // last 12 months, oldest first
}

export interface DashboardApi {
  get(): Promise<DashboardData>;
}

// ---- Encrypted backup ----

export interface BackupResult {
  saved: boolean;
  path?: string;
  counts?: Record<string, number>;
}

export interface BackupApi {
  // `pin` re-confirms the app PIN; `passphrase` encrypts the file and is needed to restore it.
  exportTo(passphrase: string): Promise<BackupResult>;
  restoreFrom(passphrase: string): Promise<BackupResult>;
}

// ---- Cloud sync ----

export type SyncState =
  "unconfigured" | "signed-out" | "mfa-needed" | "mfa-enroll" | "ready";

export interface SyncStatus {
  state: SyncState;
  managed: boolean; // true when the cloud project is built into this app (no manual setup)
  linked: boolean; // this device has been linked to a cloud account
  url: string;
  email: string | null;
  syncing: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  pending: number; // local changes not yet uploaded
  conflicts: number; // drafts replaced by a locked server copy since launch
}

export interface SyncApi {
  status(): Promise<SyncStatus>;
  configure(url: string, anonKey: string): Promise<void>;
  signUp(
    email: string,
    password: string,
    name: string,
  ): Promise<{ needsConfirmation: boolean }>;
  signIn(email: string, password: string): Promise<{ state: SyncState }>;
  verifyMfa(code: string): Promise<{ state: SyncState }>;
  enrollMfa(): Promise<{ factorId: string; qrSvg: string; secret: string }>;
  confirmMfa(factorId: string, code: string): Promise<{ state: SyncState }>;
  signOut(): Promise<void>;
  syncNow(): Promise<SyncStatus>;
}

// ---- The full renderer API ----

// Everything the shared UI needs from its host. The desktop preload implements it over IPC + SQLite;
// the web app implements it over Supabase. `backup` exists only where local backups make sense.
export interface FlowptApi {
  platform: "desktop" | "web";
  patients: PatientApi;
  notes: NoteApi;
  audit: AuditApi;
  invoices: InvoiceApi;
  settings: SettingsApi;
  dashboard: DashboardApi;
  backup?: BackupApi;
  sync: SyncApi;
}

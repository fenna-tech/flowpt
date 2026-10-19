import type Database from 'better-sqlite3-multiple-ciphers'

// Append-only list; index + 1 is the schema version stored in PRAGMA user_version.
const MIGRATIONS: string[] = [
  `CREATE TABLE patients (
    id TEXT PRIMARY KEY,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    dob TEXT NOT NULL DEFAULT '',
    phn TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );
  CREATE INDEX idx_patients_name ON patients(last_name, first_name);`,
  `CREATE TABLE chart_notes (
    id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL REFERENCES patients(id),
    template_id TEXT NOT NULL,
    visit_date TEXT NOT NULL,
    sections TEXT NOT NULL, -- JSON: [{key,label,text}]
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );
  CREATE INDEX idx_notes_patient ON chart_notes(patient_id, visit_date);`,
  // Signing, addenda and the audit log. Immutability is enforced in the DB itself, not just app code.
  `ALTER TABLE chart_notes ADD COLUMN signed_at TEXT;

  CREATE TRIGGER chart_notes_locked BEFORE UPDATE ON chart_notes
  WHEN OLD.signed_at IS NOT NULL AND (
    NEW.sections IS NOT OLD.sections OR NEW.visit_date IS NOT OLD.visit_date OR
    NEW.template_id IS NOT OLD.template_id OR NEW.patient_id IS NOT OLD.patient_id OR
    NEW.signed_at IS NOT OLD.signed_at OR NEW.deleted_at IS NOT OLD.deleted_at)
  BEGIN SELECT RAISE(ABORT, 'Signed notes cannot be modified or deleted'); END;

  CREATE TRIGGER chart_notes_no_hard_delete BEFORE DELETE ON chart_notes
  BEGIN SELECT RAISE(ABORT, 'Notes cannot be hard-deleted'); END;

  CREATE TABLE note_addenda (
    id TEXT PRIMARY KEY,
    note_id TEXT NOT NULL REFERENCES chart_notes(id),
    text TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_addenda_note ON note_addenda(note_id, created_at);
  CREATE TRIGGER addenda_no_update BEFORE UPDATE ON note_addenda
  BEGIN SELECT RAISE(ABORT, 'Addenda are append-only'); END;
  CREATE TRIGGER addenda_no_delete BEFORE DELETE ON note_addenda
  BEGIN SELECT RAISE(ABORT, 'Addenda are append-only'); END;

  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    action TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    patient_id TEXT,
    detail TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX idx_audit_patient ON audit_log(patient_id, id);
  CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_log
  BEGIN SELECT RAISE(ABORT, 'Audit log is append-only'); END;
  CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_log
  BEGIN SELECT RAISE(ABORT, 'Audit log is append-only'); END;`,
  // Billing: settings, custom billing profiles, invoices (locked once issued).
  `CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE billing_profiles (
    id TEXT PRIMARY KEY,
    definition TEXT NOT NULL, -- JSON (BillingProfile minus id/builtin)
    created_at TEXT NOT NULL,
    deleted_at TEXT
  );

  CREATE TABLE invoices (
    id TEXT PRIMARY KEY,
    number TEXT UNIQUE,
    patient_id TEXT NOT NULL REFERENCES patients(id),
    profile_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued','paid','void')),
    issue_date TEXT NOT NULL,
    payer_name TEXT NOT NULL DEFAULT '',
    policy_number TEXT NOT NULL DEFAULT '',
    items TEXT NOT NULL DEFAULT '[]', -- JSON: [{description,code,quantity,unitCents}]
    tax_pct REAL NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    snapshot TEXT, -- JSON captured at issue time so the PDF is reproducible
    paid_at TEXT,
    payment_method TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );
  CREATE INDEX idx_invoices_patient ON invoices(patient_id, issue_date);

  CREATE TRIGGER invoices_locked BEFORE UPDATE ON invoices
  WHEN OLD.status <> 'draft' AND (
    NEW.number IS NOT OLD.number OR NEW.patient_id IS NOT OLD.patient_id OR
    NEW.profile_id IS NOT OLD.profile_id OR NEW.issue_date IS NOT OLD.issue_date OR
    NEW.payer_name IS NOT OLD.payer_name OR NEW.policy_number IS NOT OLD.policy_number OR
    NEW.items IS NOT OLD.items OR NEW.tax_pct IS NOT OLD.tax_pct OR NEW.notes IS NOT OLD.notes OR
    NEW.snapshot IS NOT OLD.snapshot OR NEW.deleted_at IS NOT OLD.deleted_at OR NEW.status = 'draft')
  BEGIN SELECT RAISE(ABORT, 'Issued invoices cannot be modified; void instead'); END;

  CREATE TRIGGER invoices_void_final BEFORE UPDATE ON invoices
  WHEN OLD.status = 'void' AND NEW.status <> 'void'
  BEGIN SELECT RAISE(ABORT, 'Void invoices are final'); END;

  CREATE TRIGGER invoices_no_hard_delete BEFORE DELETE ON invoices
  BEGIN SELECT RAISE(ABORT, 'Invoices cannot be hard-deleted'); END;`,
  // Identity: who signed, who wrote each addendum, who performed each audited action.
  `ALTER TABLE chart_notes ADD COLUMN signed_by TEXT;
  ALTER TABLE note_addenda ADD COLUMN author TEXT NOT NULL DEFAULT '';
  ALTER TABLE audit_log ADD COLUMN actor TEXT NOT NULL DEFAULT '';

  DROP TRIGGER chart_notes_locked;
  CREATE TRIGGER chart_notes_locked BEFORE UPDATE ON chart_notes
  WHEN OLD.signed_at IS NOT NULL AND (
    NEW.sections IS NOT OLD.sections OR NEW.visit_date IS NOT OLD.visit_date OR
    NEW.template_id IS NOT OLD.template_id OR NEW.patient_id IS NOT OLD.patient_id OR
    NEW.signed_at IS NOT OLD.signed_at OR NEW.signed_by IS NOT OLD.signed_by OR
    NEW.deleted_at IS NOT OLD.deleted_at)
  BEGIN SELECT RAISE(ABORT, 'Signed notes cannot be modified or deleted'); END;`
]

export function migrate(db: Database.Database): void {
  const current = db.pragma('user_version', { simple: true }) as number
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v])
      db.pragma(`user_version = ${v + 1}`)
    })()
  }
}

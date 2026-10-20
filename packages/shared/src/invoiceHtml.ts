import {
  computeTotals,
  formatMoney,
  lineTotalCents,
  type Invoice,
  type InvoiceFontId,
  type InvoiceSnapshot,
  type PractitionerProfile
} from './models'

const esc = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  )
const nl = (s: string): string => esc(s).replace(/\n/g, '<br>')

const FONT_STACKS: Record<InvoiceFontId, string> = {
  sans: "'Helvetica Neue', Helvetica, Arial, sans-serif",
  humanist: "'Avenir Next', 'Segoe UI', Calibri, 'Trebuchet MS', sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  elegant: "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif"
}

// Readable text colour on top of the accent colour.
function inkOn(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6 ? '#111' : '#fff'
}

export interface InvoiceView {
  practitioner: PractitionerProfile
  style: Pick<PractitionerProfile, 'invoiceFont' | 'invoiceColor'>
  patient: InvoiceSnapshot['patient']
  profile: InvoiceSnapshot['profile']
  inv: Invoice
}

export function buildInvoiceHtml({
  practitioner: p,
  style,
  patient,
  profile,
  inv
}: InvoiceView): string {
  const accent = /^#[0-9a-f]{6}$/i.test(style.invoiceColor) ? style.invoiceColor : '#0a3d34'
  const font = FONT_STACKS[style.invoiceFont] ?? FONT_STACKS.sans
  const showCode = inv.items.some((i) => i.code)
  const insured = profile.payerLabel !== ''
  const rows = inv.items
    .map(
      (i) => `<tr>
        <td>${esc(i.description)}</td>
        ${showCode ? `<td class="muted">${esc(i.code)}</td>` : ''}
        <td class="r">${i.quantity}</td>
        <td class="r">${formatMoney(i.unitCents)}</td>
        <td class="r amt">${formatMoney(lineTotalCents(i))}</td></tr>`
    )
    .join('')
  const status =
    inv.status === 'paid'
      ? `<div class="pill paid">Paid ${esc(inv.paidAt ?? '')}</div>`
      : inv.status === 'void'
        ? '<div class="pill void">Void</div>'
        : inv.status === 'issued'
          ? '<div class="pill due">Payment due</div>'
          : ''

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    :root{--accent:${accent};--ink:${inkOn(accent)};--tint:color-mix(in srgb,var(--accent) 9%,white);--line:color-mix(in srgb,var(--accent) 18%,white)}
    *{box-sizing:border-box}
    body{font:12px/1.55 ${font};color:#1c1f1e;margin:0}
    .muted{color:#5b6461}
    .band{background:var(--accent);color:var(--ink);border-radius:14px;padding:22px 26px;display:flex;justify-content:space-between;align-items:flex-end}
    .band .biz{font-size:21px;font-weight:700;letter-spacing:-.01em}
    .band .who{opacity:.85;margin-top:2px}
    .band .word{font-size:30px;font-weight:300;letter-spacing:.22em;text-align:right}
    .band .num{font-weight:700;text-align:right;opacity:.9;letter-spacing:.04em}
    .meta{display:flex;justify-content:space-between;gap:24px;margin:18px 4px 0}
    .meta .r{text-align:right}
    .pill{display:inline-block;border-radius:999px;padding:2px 12px;font-weight:700;font-size:11px;margin-top:6px}
    .pill.due{background:var(--tint);color:var(--accent);border:1px solid var(--line)}
    .pill.paid{background:#e6f4ea;color:#1a7f37}
    .pill.void{background:#fde8e6;color:#b42318}
    .cards{display:flex;gap:12px;margin-top:20px}
    .card{flex:1;background:var(--tint);border:1px solid var(--line);border-radius:10px;padding:12px 16px}
    .label{font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);margin-bottom:3px}
    table{width:100%;border-collapse:collapse;margin-top:22px}
    th{text-align:left;background:var(--accent);color:var(--ink);padding:8px 10px;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase}
    th:first-child{border-radius:8px 0 0 8px} th:last-child{border-radius:0 8px 8px 0}
    td{padding:9px 10px;border-bottom:1px solid var(--line)}
    tbody tr:nth-child(even) td{background:color-mix(in srgb,var(--accent) 4%,white)}
    .r{text-align:right} .amt{font-weight:600}
    .totals{margin:16px 0 0 auto;width:270px}
    .totals div{display:flex;justify-content:space-between;padding:3px 10px}
    .total{background:var(--accent);color:var(--ink);border-radius:10px;font-weight:700;font-size:15px;margin-top:6px;padding:10px 12px!important}
    .foot{margin-top:26px;font-size:11px;color:#444}
    .thanks{margin-top:30px;padding-top:12px;border-top:2px solid var(--accent);display:flex;justify-content:space-between;color:var(--accent);font-weight:700}
    .thanks span:last-child{font-weight:400;color:#5b6461}
  </style></head><body>
  <div class="band">
    <div>
      <div class="biz">${esc(p.businessName || p.name)}</div>
      <div class="who">${esc(p.name)}${p.credentials ? ', ' + esc(p.credentials) : ''}</div>
    </div>
    <div><div class="word">INVOICE</div><div class="num">${esc(inv.number ?? '')}</div></div>
  </div>
  <div class="meta">
    <div class="muted">
      ${p.registrationNo ? `<div>Reg. # ${esc(p.registrationNo)}</div>` : ''}
      <div>${nl(p.address)}</div>
      <div>${esc([p.phone, p.email].filter(Boolean).join(' · '))}</div>
      ${p.gstNumber ? `<div>GST # ${esc(p.gstNumber)}</div>` : ''}
    </div>
    <div class="r"><div class="muted">Date</div><div><b>${esc(inv.issueDate)}</b></div>${status}</div>
  </div>
  <div class="cards">
    <div class="card"><div class="label">Bill to</div><b>${esc(patient.name)}</b><br>${nl(patient.address)}
      ${insured && patient.phn ? `<br>PHN: ${esc(patient.phn)}` : ''}
      ${insured && patient.dob ? `<br>DOB: ${esc(patient.dob)}` : ''}</div>
    ${
      insured
        ? `<div class="card"><div class="label">${esc(profile.payerLabel)}</div><b>${esc(inv.payerName)}</b>
           ${inv.policyNumber ? `<br>Policy / claim #: ${esc(inv.policyNumber)}` : ''}
           <div class="muted">${esc(profile.name)}</div></div>`
        : ''
    }
  </div>
  <table><thead><tr><th>Description</th>${showCode ? '<th>Code</th>' : ''}
    <th class="r">Qty</th><th class="r">Unit price</th><th class="r">Amount</th></tr></thead>
    <tbody>${rows}</tbody></table>
  <div class="totals">
    <div><span class="muted">Subtotal</span><span>${formatMoney(inv.subtotalCents)}</span></div>
    ${inv.taxPct > 0 ? `<div><span class="muted">Tax (${inv.taxPct}%)</span><span>${formatMoney(inv.taxCents)}</span></div>` : ''}
    <div class="total"><span>Total (CAD)</span><span>${formatMoney(inv.totalCents)}</span></div>
  </div>
  ${inv.notes ? `<div class="foot"><div class="label">Notes</div>${nl(inv.notes)}</div>` : ''}
  ${profile.footerNote ? `<div class="foot">${nl(profile.footerNote)}</div>` : ''}
  <div class="thanks"><span>Thank you</span><span>${esc(p.businessName || p.name)}</span></div>
  </body></html>`
}

// Issued invoices keep the practitioner details they were issued with; the look (font, colour) is
// the current setting, so changing the theme restyles past invoices when they are printed again.
export function buildIssuedInvoiceHtml(
  snap: InvoiceSnapshot,
  inv: Invoice,
  style: Pick<PractitionerProfile, 'invoiceFont' | 'invoiceColor'>
): string {
  return buildInvoiceHtml({
    practitioner: snap.practitioner,
    style: { invoiceFont: style.invoiceFont, invoiceColor: style.invoiceColor },
    patient: snap.patient,
    profile: snap.profile,
    inv
  })
}

// Sample invoice for the live preview in Settings (uses the unsaved form values).
export function previewInvoiceHtml(p: PractitionerProfile): string {
  const items = [
    {
      description: 'Initial assessment',
      code: '',
      quantity: 1,
      unitCents: 9500
    },
    {
      description: 'Treatment session',
      code: '',
      quantity: 3,
      unitCents: 7500
    }
  ]
  const totals = computeTotals(items, 0)
  const inv = {
    number: 'INV-0042',
    issueDate: new Date().toLocaleDateString('en-CA'),
    status: 'issued',
    paidAt: null,
    payerName: 'AHP',
    policyNumber: '',
    items,
    taxPct: 0,
    notes: 'Thank you for choosing us.',
    ...totals
  } as Invoice
  return buildInvoiceHtml({
    practitioner: p,
    style: p,
    patient: {
      name: 'Sample Client',
      dob: '',
      phn: '',
      address: '123 Example St\nVancouver, BC',
      email: ''
    },
    profile: { name: 'Private pay', payerLabel: '', footerNote: '' },
    inv
  })
}

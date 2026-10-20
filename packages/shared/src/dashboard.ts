import {
  computeTotals,
  type DashboardData,
  type LineItem,
  type MonthlyRevenue,
  type OutstandingInvoice,
} from "./models";

export interface DashboardInvoiceRow {
  id: string;
  number: string;
  patientId: string;
  patientName: string;
  status: "issued" | "paid";
  issueDate: string;
  paidAt: string | null;
  items: LineItem[];
  taxPct: number;
}

const localDate = (d: Date): string => d.toLocaleDateString("en-CA"); // YYYY-MM-DD
const dayMs = 86_400_000;

// Cash-basis view for a solo practice, from issued/paid invoices (void and drafts excluded).
export function buildDashboard(
  rows: DashboardInvoiceRow[],
  now = new Date(),
): DashboardData {
  const today = localDate(now);
  const thisMonth = today.slice(0, 7);
  const year = today.slice(0, 4);

  const months: MonthlyRevenue[] = [];
  for (let k = 11; k >= 0; k--) {
    const d = new Date(now.getFullYear(), now.getMonth() - k, 1);
    months.push({
      month: localDate(d).slice(0, 7),
      invoicedCents: 0,
      collectedCents: 0,
    });
  }
  const byMonth = new Map(months.map((m) => [m.month, m]));

  const outstanding: OutstandingInvoice[] = [];
  let collectedThisMonthCents = 0;
  let collectedYtdCents = 0;
  let invoicedYtdCents = 0;

  for (const r of rows) {
    const total = computeTotals(r.items, r.taxPct).totalCents;
    const issued = byMonth.get(r.issueDate.slice(0, 7));
    if (issued) issued.invoicedCents += total;
    if (r.issueDate.startsWith(year)) invoicedYtdCents += total;

    if (r.status === "paid" && r.paidAt) {
      const m = r.paidAt.slice(0, 7);
      const bucket = byMonth.get(m);
      if (bucket) bucket.collectedCents += total;
      if (m === thisMonth) collectedThisMonthCents += total;
      if (r.paidAt.startsWith(year)) collectedYtdCents += total;
    } else if (r.status === "issued") {
      outstanding.push({
        id: r.id,
        number: r.number,
        patientId: r.patientId,
        patientName: r.patientName,
        issueDate: r.issueDate,
        totalCents: total,
        daysOutstanding: Math.max(
          0,
          Math.floor((Date.parse(today) - Date.parse(r.issueDate)) / dayMs),
        ),
      });
    }
  }

  outstanding.sort((a, b) => b.daysOutstanding - a.daysOutstanding);
  return {
    outstanding,
    outstandingCents: outstanding.reduce((s, o) => s + o.totalCents, 0),
    over30Count: outstanding.filter((o) => o.daysOutstanding > 30).length,
    collectedThisMonthCents,
    collectedYtdCents,
    invoicedYtdCents,
    months,
  };
}

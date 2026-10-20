import type { FlowptApi } from '@flowpt/shared'
import { auditApi } from './audit'
import { dashboard } from './dashboard'
import { invoices } from './invoices'
import { notes } from './notes'
import { patients } from './patients'
import { settings } from './settings'
import { sync } from './sync'

// Web implementation of the window.api contract the shared UI talks to: cloud-first, straight to
// Supabase with the signed-in user's session. Row-level security (and MFA) are enforced server-side.
export const webApi: FlowptApi = {
  platform: 'web',
  patients,
  notes,
  audit: auditApi,
  invoices,
  settings,
  dashboard,
  sync
}

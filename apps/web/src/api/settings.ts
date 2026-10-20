import {
  BILLING_PROFILES,
  EMPTY_PRACTITIONER,
  cleanPractitioner,
  previewInvoiceHtml,
  type PractitionerProfile,
  type SettingsApi
} from '@flowpt/shared'
import { check, nowIso, supabase, userId } from './core'

export async function getPractitioner(): Promise<PractitionerProfile> {
  const rows = check(await supabase.from('settings').select('value').eq('key', 'practitioner')) as {
    value: string
  }[]
  if (rows[0]) {
    try {
      return { ...EMPTY_PRACTITIONER, ...JSON.parse(rows[0].value) }
    } catch {
      // fall through to defaults
    }
  }
  // First visit: seed the name given at sign-up (the desktop does the same on first link).
  const { data } = await supabase.auth.getSession()
  const name = data.session?.user.user_metadata?.name
  return { ...EMPTY_PRACTITIONER, name: typeof name === 'string' ? name.slice(0, 100) : '' }
}

export const settings: SettingsApi = {
  async previewInvoice(draft) {
    return previewInvoiceHtml({ ...(await getPractitioner()), ...draft })
  },

  getPractitioner,

  async savePractitioner(p) {
    const clean = cleanPractitioner(p)
    const rows = check(
      await supabase
        .from('settings')
        .upsert(
          {
            owner_id: await userId(),
            key: 'practitioner',
            value: JSON.stringify(clean),
            updated_at: nowIso()
          },
          { onConflict: 'owner_id,key' }
        )
        .select()
    ) as unknown[]
    if (rows.length === 0) throw new Error('Not saved: a newer version exists. Reload and retry.')
    return clean
  },

  async listProfiles() {
    return BILLING_PROFILES
  }
}

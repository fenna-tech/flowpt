-- A passkey sign-in counts as the second factor. Passkeys are phishing-resistant and need the device
-- plus a fingerprint, face or PIN, so a session whose sign-in method (amr) includes 'passkey' is as
-- good as an aal2 one. A password-only session is still refused everywhere.
create function public.mfa_satisfied() returns boolean
language sql stable set search_path = '' as $$
  select (auth.jwt() ->> 'aal') = 'aal2'
      or coalesce(auth.jwt() -> 'amr', '[]'::jsonb) @> '[{"method": "passkey"}]'::jsonb
$$;
revoke all on function public.mfa_satisfied() from public, anon;
grant execute on function public.mfa_satisfied() to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['devices', 'patients', 'chart_notes', 'note_addenda', 'billing_profiles',
                           'invoices', 'settings', 'audit_log', 'invoice_number_blocks'] loop
    execute format('drop policy %I on public.%I', t || '_mfa_required', t);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated
         using (public.mfa_satisfied()) with check (public.mfa_satisfied())', t || '_mfa_required', t);
  end loop;
end $$;

create or replace function public.lease_invoice_numbers(p_device uuid, p_count integer default 50, p_min_start integer default 1)
returns table (start_no integer, end_no integer)
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  s integer;
begin
  if me is null then raise exception 'Not authenticated'; end if;
  if not public.mfa_satisfied() then raise exception 'MFA required'; end if;
  if p_count < 1 or p_count > 500 then raise exception 'Invalid block size'; end if;
  if p_min_start < 1 or p_min_start > 100000000 then raise exception 'Invalid floor'; end if;
  if not exists (select 1 from public.devices d where d.id = p_device and d.owner_id = me) then
    raise exception 'Unknown device';
  end if;
  perform pg_advisory_xact_lock(hashtext(me::text));
  select greatest(coalesce(max(b.end_no), 0) + 1, p_min_start) into s
    from public.invoice_number_blocks b where b.owner_id = me;
  insert into public.invoice_number_blocks (owner_id, device_id, start_no, end_no)
    values (me, p_device, s, s + p_count - 1);
  return query select s, s + p_count - 1;
end $$;

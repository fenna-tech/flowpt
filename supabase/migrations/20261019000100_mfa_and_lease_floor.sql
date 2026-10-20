-- 1) Require MFA (AAL2) for every data access. Restrictive policies are ANDed with the owner policies,
--    so a password-only session (AAL1) can neither read nor write anything.
do $$
declare
  t text;
begin
  foreach t in array array['devices', 'patients', 'chart_notes', 'note_addenda', 'billing_profiles',
                           'invoices', 'settings', 'audit_log', 'invoice_number_blocks'] loop
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated
         using ((auth.jwt() ->> ''aal'') = ''aal2'')
         with check ((auth.jwt() ->> ''aal'') = ''aal2'')', t || '_mfa_required', t);
  end loop;
end $$;

-- 2) Leasing takes a floor so a device that already issued local numbers (before enabling sync)
--    never receives numbers it has already used.
drop function public.lease_invoice_numbers(uuid, integer);

create function public.lease_invoice_numbers(p_device uuid, p_count integer default 50, p_min_start integer default 1)
returns table (start_no integer, end_no integer)
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  s integer;
begin
  if me is null then raise exception 'Not authenticated'; end if;
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then raise exception 'MFA required'; end if;
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

revoke all on function public.lease_invoice_numbers(uuid, integer, integer) from public, anon;
grant execute on function public.lease_invoice_numbers(uuid, integer, integer) to authenticated;

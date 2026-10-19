-- FlowPT cloud schema. One practitioner account owns every row (owner_id = auth.uid()).
-- Mirrors the desktop SQLite schema. Local tables hold ids as text UUIDs; here they are uuid.
-- Sync is pull-by-cursor on server_ts + idempotent upserts (see docs/sync-design.md).

-- ---------- helper functions ----------

-- Server-assigned change cursor. Unchanged re-pushes keep their old server_ts so clients
-- are not woken for no-op upserts.
create function public.set_server_ts() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'server_ts') = (to_jsonb(old) - 'server_ts') then
    new.server_ts := old.server_ts;
  else
    new.server_ts := clock_timestamp();
  end if;
  return new;
end $$;

-- Last-writer-wins for drafts: a write older than the stored row is silently ignored.
create function public.ignore_stale_write() returns trigger
language plpgsql as $$
begin
  if new.updated_at < old.updated_at then
    return null; -- skip this UPDATE
  end if;
  return new;
end $$;

-- ---------- tables ----------

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  server_ts timestamptz not null default clock_timestamp()
);

create table public.patients (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  first_name text not null,
  last_name text not null,
  dob text not null default '',
  phn text not null default '',
  email text not null default '',
  phone text not null default '',
  address text not null default '',
  notes text not null default '',
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  server_ts timestamptz not null default clock_timestamp()
);

create table public.chart_notes (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  patient_id uuid not null references public.patients (id),
  template_id text not null,
  visit_date date not null,
  sections jsonb not null,
  signed_at timestamptz,
  signed_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  server_ts timestamptz not null default clock_timestamp()
);

create table public.note_addenda (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  note_id uuid not null references public.chart_notes (id),
  text text not null,
  author text not null default '',
  created_at timestamptz not null,
  server_ts timestamptz not null default clock_timestamp()
);

create table public.billing_profiles (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  definition jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_ts timestamptz not null default clock_timestamp()
);

create table public.invoices (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  number text,
  patient_id uuid not null references public.patients (id),
  profile_id text not null, -- 'private' or a billing_profiles.id
  status text not null default 'draft' check (status in ('draft', 'issued', 'paid', 'void')),
  issue_date date not null,
  payer_name text not null default '',
  policy_number text not null default '',
  items jsonb not null default '[]',
  tax_pct numeric(6, 3) not null default 0,
  notes text not null default '',
  snapshot jsonb,
  paid_at date,
  payment_method text not null default '',
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  server_ts timestamptz not null default clock_timestamp(),
  unique (owner_id, number)
);

-- Only the practitioner profile syncs. PIN hash, lock state and counters stay on the device.
create table public.settings (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  key text not null check (key in ('practitioner')),
  value text not null,
  updated_at timestamptz not null,
  server_ts timestamptz not null default clock_timestamp(),
  primary key (owner_id, key)
);

-- Audit entries are generated on devices and uploaded; insert-only.
create table public.audit_log (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  device_id uuid references public.devices (id),
  ts timestamptz not null,
  action text not null,
  entity text not null,
  entity_id text not null,
  patient_id uuid,
  actor text not null default '',
  detail text not null default '',
  server_ts timestamptz not null default clock_timestamp()
);

-- Invoice numbers are leased to devices in blocks so offline devices never collide.
create table public.invoice_number_blocks (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  device_id uuid not null references public.devices (id),
  start_no integer not null,
  end_no integer not null,
  leased_at timestamptz not null default now(),
  primary key (owner_id, start_no)
);

-- ---------- immutability (mirrors the local triggers) ----------

create function public.guard_signed_note() returns trigger
language plpgsql as $$
begin
  if old.signed_at is not null and (
    new.sections is distinct from old.sections or new.visit_date is distinct from old.visit_date or
    new.template_id is distinct from old.template_id or new.patient_id is distinct from old.patient_id or
    new.signed_at is distinct from old.signed_at or new.signed_by is distinct from old.signed_by or
    new.deleted_at is distinct from old.deleted_at) then
    raise exception 'Signed notes cannot be modified or deleted';
  end if;
  return new;
end $$;

create function public.guard_invoice() returns trigger
language plpgsql as $$
begin
  if old.status = 'void' and new.status <> 'void' then
    raise exception 'Void invoices are final';
  end if;
  if old.status <> 'draft' and (
    new.status = 'draft' or new.number is distinct from old.number or
    new.patient_id is distinct from old.patient_id or new.profile_id is distinct from old.profile_id or
    new.issue_date is distinct from old.issue_date or new.payer_name is distinct from old.payer_name or
    new.policy_number is distinct from old.policy_number or new.items is distinct from old.items or
    new.tax_pct is distinct from old.tax_pct or new.notes is distinct from old.notes or
    new.snapshot is distinct from old.snapshot or new.deleted_at is distinct from old.deleted_at) then
    raise exception 'Issued invoices cannot be modified; void instead';
  end if;
  return new;
end $$;

create function public.append_only() returns trigger
language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name;
end $$;

create trigger b_guard_signed_note before update on public.chart_notes
  for each row execute function public.guard_signed_note();
create trigger b_guard_invoice before update on public.invoices
  for each row execute function public.guard_invoice();
create trigger b_append_only before update on public.note_addenda
  for each row execute function public.append_only();
create trigger b_append_only before update on public.audit_log
  for each row execute function public.append_only();

-- ---------- generic triggers, indexes, row-level security ----------

do $$
declare
  t text;
begin
  -- last-writer-wins for tables with a client-maintained updated_at
  foreach t in array array['patients', 'chart_notes', 'invoices', 'billing_profiles', 'settings'] loop
    execute format(
      'create trigger a_ignore_stale before update on public.%I
         for each row execute function public.ignore_stale_write()', t);
  end loop;

  foreach t in array array['devices', 'patients', 'chart_notes', 'note_addenda', 'billing_profiles',
                           'invoices', 'settings', 'audit_log'] loop
    execute format(
      'create trigger zz_server_ts before insert or update on public.%I
         for each row execute function public.set_server_ts()', t);
    execute format('create index on public.%I (owner_id, server_ts)', t);
  end loop;

  -- Row-level security: a practitioner sees and writes only their own rows.
  -- No DELETE policy exists anywhere, so clients cannot hard-delete (soft delete via deleted_at).
  foreach t in array array['devices', 'patients', 'chart_notes', 'note_addenda', 'billing_profiles',
                           'invoices', 'settings', 'audit_log', 'invoice_number_blocks'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated
                      using (owner_id = auth.uid())', t || '_select', t);
  end loop;

  foreach t in array array['devices', 'patients', 'chart_notes', 'note_addenda', 'billing_profiles',
                           'invoices', 'settings', 'audit_log'] loop
    execute format('create policy %I on public.%I for insert to authenticated
                      with check (owner_id = auth.uid())', t || '_insert', t);
  end loop;

  foreach t in array array['devices', 'patients', 'chart_notes', 'billing_profiles', 'invoices',
                           'settings'] loop
    execute format('create policy %I on public.%I for update to authenticated
                      using (owner_id = auth.uid()) with check (owner_id = auth.uid())',
                   t || '_update', t);
  end loop;
end $$;

-- ---------- invoice number leasing ----------

-- Reserves the next contiguous block of invoice numbers for a device. Gaps are fine; duplicates are not.
create function public.lease_invoice_numbers(p_device uuid, p_count integer default 50)
returns table (start_no integer, end_no integer)
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  s integer;
begin
  if me is null then raise exception 'Not authenticated'; end if;
  if p_count < 1 or p_count > 500 then raise exception 'Invalid block size'; end if;
  if not exists (select 1 from public.devices d where d.id = p_device and d.owner_id = me) then
    raise exception 'Unknown device';
  end if;
  perform pg_advisory_xact_lock(hashtext(me::text));
  select coalesce(max(b.end_no), 0) + 1 into s from public.invoice_number_blocks b where b.owner_id = me;
  insert into public.invoice_number_blocks (owner_id, device_id, start_no, end_no)
    values (me, p_device, s, s + p_count - 1);
  return query select s, s + p_count - 1;
end $$;

revoke all on function public.lease_invoice_numbers(uuid, integer) from public, anon;
grant execute on function public.lease_invoice_numbers(uuid, integer) to authenticated;

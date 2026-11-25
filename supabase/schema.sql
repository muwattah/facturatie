-- Run once in a NEW Supabase project, via SQL Editor.
begin;
create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null
);
create table public.household_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade
);
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  supplier text not null check (length(trim(supplier)) between 1 and 180),
  invoice_no text not null default '' check (length(invoice_no)<=100),
  reference text not null default '' check (reference='' or reference ~ '^[0-9]{12}$'),
  iban text not null default '' check (length(iban)<=34),
  invoice_date date,
  amount_cents integer not null check (amount_cents between 1 and 100000000),
  status text not null default 'unpaid' check (status in ('unpaid','paying','paid')),
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  updated_at timestamptz not null default now(),
  check (invoice_no<>'' or reference<>'')
);
create index invoices_household_idx on public.invoices(household_id, created_at desc);
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.invoices enable row level security;
revoke all on public.households, public.household_members, public.invoices from anon, authenticated;
grant select on public.household_members, public.invoices to authenticated;
create policy own_membership on public.household_members for select to authenticated using (user_id=auth.uid());
create policy own_invoices on public.invoices for select to authenticated using (
  household_id in (select household_id from public.household_members where user_id=auth.uid())
);

create function public.invoice_norm(v text) returns text language sql immutable
set search_path='' as $$
  select regexp_replace(translate(upper(coalesce(v,'')), 'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝŸ', 'AAAAAACEEEEIIIINOOOOOUUUUYY'), '[^A-Z0-9]', '', 'g')
$$;
revoke all on function public.invoice_norm(text) from public;

-- Serialized per household: two phones cannot insert the same exact invoice concurrently.
create function public.register_invoice(p jsonb, p_allow_possible boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  h uuid;
  v public.invoices%rowtype;
  found_invoice public.invoices%rowtype;
begin
  select household_id into h from public.household_members where user_id=auth.uid();
  if h is null then raise exception 'Geen toegang tot een huishouden'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(h::text,0));
  v.household_id := h;
  v.supplier := trim(coalesce(p->>'supplier',''));
  v.invoice_no := trim(coalesce(p->>'invoice_no',''));
  v.reference := regexp_replace(coalesce(p->>'reference',''),'[^0-9]','','g');
  v.iban := public.invoice_norm(p->>'iban');
  v.invoice_date := nullif(p->>'invoice_date','')::date;
  v.amount_cents := (p->>'amount_cents')::integer;
  if v.reference<>'' then
    if v.reference !~ '^[0-9]{12}$' then raise exception 'Ongeldige mededeling'; end if;
    if right(v.reference,2)::int <> coalesce(nullif(left(v.reference,10)::bigint % 97,0),97) then
      raise exception 'Ongeldig controlegetal mededeling';
    end if;
  end if;
  if public.invoice_norm(v.supplier)='' or (public.invoice_norm(v.invoice_no)='' and v.reference='') then
    raise exception 'Vul leverancier en factuurnummer of geldige mededeling in';
  end if;
  if v.amount_cents is null or v.amount_cents<=0 then raise exception 'Ongeldig bedrag'; end if;
  select i.* into found_invoice from public.invoices i where i.household_id=h and (
    (v.reference<>'' and i.reference=v.reference) or
    (public.invoice_norm(v.invoice_no)<>'' and public.invoice_norm(i.invoice_no)=public.invoice_norm(v.invoice_no)
      and (public.invoice_norm(i.supplier)=public.invoice_norm(v.supplier) or (v.iban<>'' and i.iban=v.iban)))
  ) order by case i.status when 'paid' then 0 when 'paying' then 1 else 2 end, i.created_at desc limit 1;
  if found then return jsonb_build_object('kind','exact','invoice',to_jsonb(found_invoice)); end if;
  if not coalesce(p_allow_possible,false) then
    select i.* into found_invoice from public.invoices i where i.household_id=h and i.amount_cents=v.amount_cents
      and (public.invoice_norm(i.supplier)=public.invoice_norm(v.supplier) or (v.iban<>'' and i.iban=v.iban))
      and (i.invoice_date is null or v.invoice_date is null or abs(i.invoice_date-v.invoice_date)<=31)
      order by case i.status when 'paid' then 0 when 'paying' then 1 else 2 end, i.created_at desc limit 1;
    if found then return jsonb_build_object('kind','possible','invoice',to_jsonb(found_invoice)); end if;
  end if;
  insert into public.invoices(household_id,supplier,invoice_no,reference,iban,invoice_date,amount_cents)
    values(h,v.supplier,v.invoice_no,v.reference,v.iban,v.invoice_date,v.amount_cents) returning * into found_invoice;
  return jsonb_build_object('kind','new','invoice',to_jsonb(found_invoice));
end $$;
revoke all on function public.register_invoice(jsonb,boolean) from public, anon, authenticated;
grant execute on function public.register_invoice(jsonb,boolean) to authenticated;

-- Compare-and-set: only one person can reserve an unpaid invoice for payment.
create function public.set_invoice_status(p_id uuid,p_expected text,p_next text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare h uuid; v public.invoices%rowtype;
begin
  select household_id into h from public.household_members where user_id=auth.uid();
  if h is null then raise exception 'Geen toegang tot een huishouden'; end if;
  if not ((p_expected='unpaid' and p_next='paying') or
          (p_expected='paying' and p_next in ('paid','unpaid')) or
          (p_expected='paid' and p_next='unpaid')) then
    raise exception 'Ongeldige statuswijziging';
  end if;
  update public.invoices set status=p_next,updated_at=now(),
    paid_at=case when p_next='paid' then now() else null end
    where id=p_id and household_id=h and status=p_expected returning * into v;
  if not found then raise exception 'Status gewijzigd of factuur niet gevonden. Vernieuw de lijst.'; end if;
  return to_jsonb(v);
end $$;
revoke all on function public.set_invoice_status(uuid,text,text) from public, anon, authenticated;
grant execute on function public.set_invoice_status(uuid,text,text) to authenticated;
commit;

-- Provisioning (run separately after creating family users in Authentication > Users):
-- insert into public.households(name) values ('Ons gezin') returning id;
-- Replace placeholders with actual UUIDs from the dashboard and the result above.
-- insert into public.household_members(user_id,household_id)
-- values ('USER_UUID','HOUSEHOLD_UUID');
-- Repeat membership insertion per user with the same household ID.

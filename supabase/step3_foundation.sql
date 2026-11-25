-- FactuurCheck step 3 foundation. NEW test project only.
-- Do not use with real invoices until edge API, backup and isolation tests pass.
begin;
create table public.fc_households (
 id uuid primary key default gen_random_uuid(),
 name text not null check (char_length(trim(name)) between 1 and 120),
 created_at timestamptz not null default now()
);
create table public.fc_members (
 user_id uuid primary key references auth.users(id) on delete cascade,
 household_id uuid not null references public.fc_households(id) on delete cascade,
 member_role text not null default 'member' check (member_role in ('owner','member')),
 created_at timestamptz not null default now()
);
create index fc_members_household_idx on public.fc_members(household_id);
-- Keep the existing v0.4 dossier structure intact. This first cloud design
-- uses one revisioned archive per household, serialized by CAS writes.
-- For larger archives, normalize to per-dossier tables before scaling.
create table public.fc_archives (
 household_id uuid primary key references public.fc_households(id) on delete cascade,
 revision bigint not null default 0 check(revision>=0),
 dossiers jsonb not null default '[]'::jsonb check(jsonb_typeof(dossiers)='array'),
 updated_at timestamptz not null default now(),
 updated_by uuid references auth.users(id) on delete set null
);
create table public.fc_audit (
 id bigint generated always as identity primary key,
 household_id uuid not null references public.fc_households(id) on delete cascade,
 actor_id uuid references auth.users(id) on delete set null,
 revision bigint not null,
 operation_id uuid not null,
 action text not null check(action in ('register','reserve','payment','reverse','release','reconcile','import')),
 created_at timestamptz not null default now(),
 unique(household_id,revision),
 unique(household_id,operation_id)
);
alter table public.fc_households enable row level security;
alter table public.fc_members enable row level security;
alter table public.fc_archives enable row level security;
alter table public.fc_audit enable row level security;
revoke all on public.fc_households,public.fc_members,public.fc_archives,public.fc_audit from public,anon,authenticated;
grant select on public.fc_households,public.fc_members,public.fc_archives,public.fc_audit to authenticated;
grant select on public.fc_households,public.fc_members,public.fc_archives,public.fc_audit to service_role;
create policy fc_members_self on public.fc_members for select to authenticated using(user_id=(select auth.uid()));
create policy fc_household_read on public.fc_households for select to authenticated using(
 id in (select household_id from public.fc_members where user_id=(select auth.uid())));
create policy fc_archive_read on public.fc_archives for select to authenticated using(
 household_id in (select household_id from public.fc_members where user_id=(select auth.uid())));
create policy fc_audit_read on public.fc_audit for select to authenticated using(
 household_id in (select household_id from public.fc_members where user_id=(select auth.uid())));
-- Create a private bucket. Objects are stored as HOUSEHOLD_UUID/SHA256.
-- No client write policy: the authenticated edge gateway must verify identity,
-- compute SHA-256 from actual bytes and upload with its server-only credential.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('factuurcheck-private','factuurcheck-private',false,20971520,
 array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf']);
create policy fc_file_read on storage.objects for select to authenticated using(
 bucket_id='factuurcheck-private'
 and (storage.foldername(name))[1] in (
   select household_id::text from public.fc_members where user_id=(select auth.uid())
 )
);
-- Server-only compare-and-swap. The gateway must compute the next archive
-- from the current authoritative rows and the validated action, never accept
-- an arbitrary replacement archive from the browser. An out-of-date write
-- fails and must be re-evaluated against the latest archive.
create function public.fc_commit_archive(
 p_actor uuid,p_household uuid,p_expected bigint,p_next jsonb,p_operation uuid,p_action text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.fc_archives%rowtype; prior bigint;
begin
 if p_actor is null or p_household is null or p_operation is null or p_expected is null then
   raise exception 'Missing operation identity';
 end if;
 if p_action is null or p_action not in ('register','reserve','payment','reverse','release','reconcile','import') then
   raise exception 'Invalid operation';
 end if;
 if p_next is null or jsonb_typeof(p_next)<>'array' or octet_length(p_next::text)>10485760 then
   raise exception 'Invalid archive size or shape';
 end if;
 -- Serialize operations and recheck membership while holding lock.
 select * into r from public.fc_archives where household_id=p_household for update;
 if not found then raise exception 'Archive unavailable'; end if;
 perform 1 from public.fc_members where user_id=p_actor and household_id=p_household for share;
 if not found then raise exception 'Not a household member'; end if;
 select revision into prior from public.fc_audit where household_id=p_household and operation_id=p_operation;
 if found then
   return jsonb_build_object('kind','replayed','revision',r.revision,'operation_revision',prior);
 end if;
 if r.revision<>p_expected then return jsonb_build_object('kind','conflict','revision',r.revision); end if;
 update public.fc_archives set dossiers=p_next,revision=revision+1,updated_at=now(),updated_by=p_actor
 where household_id=p_household returning * into r;
 insert into public.fc_audit(household_id,actor_id,revision,operation_id,action)
 values(p_household,p_actor,r.revision,p_operation,p_action);
 return jsonb_build_object('kind','committed','revision',r.revision);
end $$;
revoke all on function public.fc_commit_archive(uuid,uuid,bigint,jsonb,uuid,text) from public,anon,authenticated;
grant execute on function public.fc_commit_archive(uuid,uuid,bigint,jsonb,uuid,text) to service_role;
commit;
-- Admin provisioning (after creating actual auth users):
-- WITH h AS (INSERT INTO public.fc_households(name) VALUES ('Ons gezin') RETURNING id)
-- INSERT INTO public.fc_archives(household_id) SELECT id FROM h RETURNING household_id;
-- INSERT INTO public.fc_members(user_id,household_id,member_role)
-- VALUES ('actual auth user UUID','actual household UUID','owner');
-- Repeat for each family member with member_role='member'.
-- Do not grant INSERT or UPDATE on archives/audit to browser users.

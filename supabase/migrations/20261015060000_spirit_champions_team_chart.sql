-- Spirit Champions HQ team site: members, team access with join codes, photo storage.
-- Applied to the AHV Supabase project (all objects prefixed sc_).

-- Keep Spirit Champions team accounts out of the AHV applicant tables
create or replace function public.handle_new_user()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if coalesce(new.raw_app_meta_data->>'app', '') = 'spirit-champions' then
    return new;
  end if;
  insert into public.profiles (id, email, full_name)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data->>'full_name', ''));
  insert into public.user_roles (user_id, role) values (new.id, 'applicant');
  return new;
end $function$;

-- Members shown on the chart
create table public.sc_members (
  id uuid primary key default gen_random_uuid(),
  name text not null default '' check (char_length(name) <= 80),
  role text not null default '' check (char_length(role) <= 80),
  bio text not null default '' check (char_length(bio) <= 700),
  grp text not null default 'team' check (grp in ('lead','team')),
  position int not null default 999 check (position between 1 and 999),
  photo_url text check (photo_url is null or char_length(photo_url) <= 500),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- Who may sign in and edit
create table public.sc_team_access (
  email text primary key check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  is_admin boolean not null default false,
  user_id uuid unique references auth.users(id) on delete set null,
  code_hash text,
  code_expires timestamptz,
  failed_attempts int not null default 0,
  added_at timestamptz not null default now(),
  joined_at timestamptz
);

create or replace function public.sc_is_team() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.sc_team_access a where a.user_id = auth.uid());
$$;
create or replace function public.sc_is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.sc_team_access a where a.user_id = auth.uid() and a.is_admin);
$$;

create or replace function public.sc_members_stamp() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;
create trigger sc_members_stamp before insert or update on public.sc_members
  for each row execute function public.sc_members_stamp();

alter table public.sc_members enable row level security;
alter table public.sc_team_access enable row level security;

create policy "Anyone can view the chart" on public.sc_members for select to anon, authenticated using (true);
create policy "Team adds members" on public.sc_members for insert to authenticated with check ((select public.sc_is_team()));
create policy "Team edits members" on public.sc_members for update to authenticated using ((select public.sc_is_team())) with check ((select public.sc_is_team()));
create policy "Team removes members" on public.sc_members for delete to authenticated using ((select public.sc_is_team()));

revoke all on public.sc_team_access from anon, authenticated;
grant select (email, is_admin, user_id, code_expires, failed_attempts, added_at, joined_at) on public.sc_team_access to authenticated;
grant insert (email, is_admin) on public.sc_team_access to authenticated;
grant update (is_admin) on public.sc_team_access to authenticated;
grant delete on public.sc_team_access to authenticated;

create policy "Admins and self can view access" on public.sc_team_access for select to authenticated
  using ((select public.sc_is_admin()) or user_id = (select auth.uid()));
create policy "Admins add access" on public.sc_team_access for insert to authenticated with check ((select public.sc_is_admin()));
create policy "Admins change others' access" on public.sc_team_access for update to authenticated
  using ((select public.sc_is_admin()) and user_id is distinct from (select auth.uid()))
  with check ((select public.sc_is_admin()));
create policy "Admins remove others' access" on public.sc_team_access for delete to authenticated
  using ((select public.sc_is_admin()) and user_id is distinct from (select auth.uid()));

-- Admin issues a one-time join code (shown once, stored hashed, valid 7 days)
create or replace function public.sc_issue_code(p_email text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_code text;
begin
  if not public.sc_is_admin() then raise exception 'Only admins can issue join codes'; end if;
  v_code := lpad(((('x' || lpad(encode(extensions.gen_random_bytes(4), 'hex'), 16, '0'))::bit(64)::bigint) % 1000000)::text, 6, '0');
  update public.sc_team_access
     set code_hash = extensions.crypt(v_code, extensions.gen_salt('bf')),
         code_expires = now() + interval '7 days',
         failed_attempts = 0
   where email = lower(trim(p_email));
  if not found then raise exception 'That email is not on the team list'; end if;
  return v_code;
end $$;

-- Used only by the sc-join edge function (service role)
create or replace function public.sc_check_code(p_email text, p_code text) returns text
language plpgsql security definer set search_path = '' as $$
declare r public.sc_team_access%rowtype;
begin
  select * into r from public.sc_team_access where email = lower(trim(p_email)) for update;
  if not found or r.code_hash is null then return 'no_code'; end if;
  if r.code_expires < now() then return 'expired'; end if;
  if r.failed_attempts >= 5 then return 'locked'; end if;
  if extensions.crypt(p_code, r.code_hash) = r.code_hash then return 'ok'; end if;
  update public.sc_team_access set failed_attempts = failed_attempts + 1 where email = r.email;
  return 'wrong';
end $$;

create or replace function public.sc_find_user(p_email text) returns table (id uuid, app text)
language sql stable security definer set search_path = '' as $$
  select u.id, coalesce(u.raw_app_meta_data->>'app', '') from auth.users u where lower(u.email) = lower(trim(p_email)) limit 1;
$$;

create or replace function public.sc_complete_join(p_email text, p_user uuid) returns void
language sql security definer set search_path = '' as $$
  update public.sc_team_access
     set user_id = p_user, joined_at = coalesce(joined_at, now()), code_hash = null, code_expires = null, failed_attempts = 0
   where email = lower(trim(p_email));
$$;

revoke all on function public.sc_issue_code(text) from public, anon;
grant execute on function public.sc_issue_code(text) to authenticated;
revoke all on function public.sc_check_code(text, text) from public, anon, authenticated;
revoke all on function public.sc_find_user(text) from public, anon, authenticated;
revoke all on function public.sc_complete_join(text, uuid) from public, anon, authenticated;
grant execute on function public.sc_check_code(text, text) to service_role;
grant execute on function public.sc_find_user(text) to service_role;
grant execute on function public.sc_complete_join(text, uuid) to service_role;
revoke all on function public.sc_is_team() from public, anon;
revoke all on function public.sc_is_admin() from public, anon;
grant execute on function public.sc_is_team() to authenticated;
grant execute on function public.sc_is_admin() to authenticated;

-- Photo storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sc-member-photos', 'sc-member-photos', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy "SC team views photo files" on storage.objects for select to authenticated
  using (bucket_id = 'sc-member-photos' and (select public.sc_is_team()));
create policy "SC team uploads photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'sc-member-photos' and (select public.sc_is_team()));
create policy "SC team deletes photos" on storage.objects for delete to authenticated
  using (bucket_id = 'sc-member-photos' and (select public.sc_is_team()));

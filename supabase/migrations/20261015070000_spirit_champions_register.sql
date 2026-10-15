-- Session register (arrivals) and takeaways ("Before you leave").
-- Anyone may add a row; only signed-in team members can read; only admins can delete.

create table public.sc_attendance (
  id uuid primary key default gen_random_uuid(),
  session_date date not null default ((now() at time zone 'Africa/Johannesburg')::date),
  full_name text not null check (char_length(trim(full_name)) between 2 and 80),
  phone text check (phone is null or char_length(phone) <= 20),
  email text check (email is null or char_length(email) <= 120),
  spiritual_centre text check (spiritual_centre is null or char_length(spiritual_centre) <= 80),
  institution text check (institution is null or char_length(institution) <= 120),
  first_time boolean,
  consent_media boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.sc_takeaways (
  id uuid primary key default gen_random_uuid(),
  session_date date not null default ((now() at time zone 'Africa/Johannesburg')::date),
  full_name text not null check (char_length(trim(full_name)) between 2 and 80),
  phone text check (phone is null or char_length(phone) <= 20),
  takeaway text not null check (char_length(trim(takeaway)) between 3 and 500),
  created_at timestamptz not null default now()
);
alter table public.sc_attendance enable row level security;
alter table public.sc_takeaways enable row level security;

revoke all on public.sc_attendance, public.sc_takeaways from anon, authenticated;
grant insert (full_name, phone, email, spiritual_centre, institution, first_time, consent_media) on public.sc_attendance to anon, authenticated;
grant insert (full_name, phone, takeaway) on public.sc_takeaways to anon, authenticated;
grant select, delete on public.sc_attendance, public.sc_takeaways to authenticated;

create policy "Anyone signs the register" on public.sc_attendance for insert to anon, authenticated with check (true);
create policy "Team reads the register" on public.sc_attendance for select to authenticated using ((select public.sc_is_team()));
create policy "Admins remove register rows" on public.sc_attendance for delete to authenticated using ((select public.sc_is_admin()));
create policy "Anyone adds a takeaway" on public.sc_takeaways for insert to anon, authenticated with check (true);
create policy "Team reads takeaways" on public.sc_takeaways for select to authenticated using ((select public.sc_is_team()));
create policy "Admins remove takeaways" on public.sc_takeaways for delete to authenticated using ((select public.sc_is_admin()));

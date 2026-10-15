-- One-time permission, set only from the database, for a join code to reset the
-- password of an account that already exists in another MSRI/AHV system.
-- The sc-join function clears it after one use.
alter table public.sc_team_access add column if not exists allow_reset boolean not null default false;

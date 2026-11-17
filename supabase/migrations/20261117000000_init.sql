-- IPTV Player: synced user data. Catalogs and EPG stay on each device; only small personal data syncs.
-- Every row belongs to auth.uid() (row-level security). Deletes are soft (deleted_at) so other devices learn about them.

-- gen_random_uuid() is built into Postgres 13+

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- One helper creates a synced table with the common columns, RLS policies, trigger and pull index.
create or replace function public._iptv_sync_table(t text) returns void language plpgsql as $$
begin
  execute format('alter table public.%I enable row level security', t);
  execute format('create policy "own rows: select" on public.%I for select using (user_id = auth.uid())', t);
  execute format('create policy "own rows: insert" on public.%I for insert with check (user_id = auth.uid())', t);
  execute format('create policy "own rows: update" on public.%I for update using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  execute format('create policy "own rows: delete" on public.%I for delete using (user_id = auth.uid())', t);
  execute format('create trigger %I before insert or update on public.%I for each row execute function public.touch_updated_at()', t || '_touch', t);
  execute format('create index %I on public.%I (user_id, updated_at)', t || '_pull', t);
end $$;

-- Rows use the same keys as the device database ("key" = the local primary key joined with '|').
create table public.profiles (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  key text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, key)
);

create table public.playlists (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  key text not null,
  data jsonb not null,               -- name, type, order, hostHint (no credentials)
  creds_cipher text,                 -- AES-GCM ciphertext made by the "secrets" edge function
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, key)
);

create table public.category_prefs (like public.profiles including all);
create table public.favorites (like public.profiles including all);
create table public.watch_progress (like public.profiles including all);
create table public.channel_groups (like public.profiles including all);
create table public.reminders (like public.profiles including all);
create table public.settings (like public.profiles including all);

-- "including all" copies defaults/PK/indexes but not the FK or policies; add them per table.
do $$
declare t text;
begin
  foreach t in array array['category_prefs','favorites','watch_progress','channel_groups','reminders','settings'] loop
    execute format('alter table public.%I add constraint %I foreign key (user_id) references auth.users on delete cascade', t, t || '_user_fk');
  end loop;
  foreach t in array array['profiles','playlists','category_prefs','favorites','watch_progress','channel_groups','reminders','settings'] loop
    perform public._iptv_sync_table(t);
  end loop;
end $$;

-- Devices signed in to the account (for "Send to TV" and the phone remote).
create table public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  kind text not null check (kind in ('tv', 'phone', 'tablet', 'desktop')),
  last_seen timestamptz not null default now()
);
alter table public.devices enable row level security;
create policy "own devices" on public.devices for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Commands sent from one device to another (play this, search that). Delivered over Realtime.
create table public.remote_commands (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  target_device uuid not null references public.devices on delete cascade,
  command jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.remote_commands enable row level security;
create policy "own commands" on public.remote_commands for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create index remote_commands_target on public.remote_commands (target_device, created_at);

-- TV sign-in by code: the TV shows a code/QR, a signed-in phone approves it.
-- Only the "device-login" edge function (service role) touches this table.
create table public.device_codes (
  code text primary key,
  device_secret text not null,
  user_id uuid references auth.users on delete cascade,
  token_hash text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.device_codes enable row level security; -- no policies: clients cannot read it

-- Realtime: sync tables and commands
alter publication supabase_realtime add table
  public.profiles, public.playlists, public.category_prefs, public.favorites, public.watch_progress,
  public.channel_groups, public.reminders, public.settings, public.remote_commands;

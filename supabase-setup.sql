-- Email Template Bank: database setup.
-- Copy ALL of this, paste it into Supabase > SQL Editor > New query, and click Run. Run it once.

-- 1. One table holds your projects, templates and settings.
create table if not exists public.docs (
  collection text not null,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);

-- 2. Only people who are signed in can read or change it.
alter table public.docs enable row level security;
drop policy if exists "signed in can read" on public.docs;
drop policy if exists "signed in can add" on public.docs;
drop policy if exists "signed in can change" on public.docs;
drop policy if exists "signed in can remove" on public.docs;
create policy "signed in can read"   on public.docs for select to authenticated using (true);
create policy "signed in can add"    on public.docs for insert to authenticated with check (true);
create policy "signed in can change" on public.docs for update to authenticated using (true) with check (true);
create policy "signed in can remove" on public.docs for delete to authenticated using (true);

-- 3. Live updates, so a change on one computer shows on another.
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null; end $$;

-- 4. A folder for the images you upload.
insert into storage.buckets (id, name, public) values ('assets', 'assets', true)
on conflict (id) do nothing;
drop policy if exists "signed in can upload images" on storage.objects;
drop policy if exists "signed in can remove images" on storage.objects;
create policy "signed in can upload images" on storage.objects for insert to authenticated with check (bucket_id = 'assets');
create policy "signed in can remove images" on storage.objects for delete to authenticated using (bucket_id = 'assets');

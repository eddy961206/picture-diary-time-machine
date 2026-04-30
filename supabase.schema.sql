create table if not exists public.diary_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  diary_date text,
  weather text,
  title text not null,
  child text,
  place text not null,
  diary_text text not null,
  detail text not null,
  image_url text not null,
  image_path text,
  image_format text not null default 'png',
  prompt text,
  created_at timestamptz not null default now()
);

alter table public.diary_entries
  add column if not exists image_path text;

create index if not exists diary_entries_user_created_idx
  on public.diary_entries (user_id, created_at desc);

alter table public.diary_entries enable row level security;

drop policy if exists "Users can read own diary entries" on public.diary_entries;
create policy "Users can read own diary entries"
  on public.diary_entries
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own diary entries" on public.diary_entries;
create policy "Users can insert own diary entries"
  on public.diary_entries
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own diary entries" on public.diary_entries;
create policy "Users can delete own diary entries"
  on public.diary_entries
  for delete
  using (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values ('diary-images', 'diary-images', false)
on conflict (id) do nothing;

update storage.buckets
set public = false
where id = 'diary-images';

drop policy if exists "Users can upload own diary images" on storage.objects;
create policy "Users can upload own diary images"
  on storage.objects
  for insert
  with check (
    bucket_id = 'diary-images'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "Users can read diary images" on storage.objects;
create policy "Users can read diary images"
  on storage.objects
  for select
  using (
    bucket_id = 'diary-images'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "Users can delete own diary images" on storage.objects;
create policy "Users can delete own diary images"
  on storage.objects
  for delete
  using (
    bucket_id = 'diary-images'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create table if not exists public.diary_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id uuid,
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

create table if not exists public.diary_books (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 30),
  invite_code text not null unique check (invite_code ~ '^[A-Z0-9]{7,12}$'),
  member_limit integer not null default 12 check (member_limit between 2 and 12),
  created_at timestamptz not null default now()
);

create table if not exists public.diary_book_members (
  book_id uuid not null references public.diary_books(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (book_id, user_id)
);

alter table public.diary_entries
  add column if not exists image_path text;

alter table public.diary_entries
  add column if not exists book_id uuid references public.diary_books(id) on delete set null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'diary_entries_book_id_fkey'
  ) then
    alter table public.diary_entries
      add constraint diary_entries_book_id_fkey
      foreign key (book_id)
      references public.diary_books(id)
      on delete set null;
  end if;
end;
$$;

create index if not exists diary_entries_user_created_idx
  on public.diary_entries (user_id, created_at desc);

create index if not exists diary_entries_book_created_idx
  on public.diary_entries (book_id, created_at desc);

create index if not exists diary_book_members_user_idx
  on public.diary_book_members (user_id, book_id);

alter table public.diary_entries enable row level security;
alter table public.diary_books enable row level security;
alter table public.diary_book_members enable row level security;

drop policy if exists "Users can create diary books" on public.diary_books;
create policy "Users can create diary books"
  on public.diary_books
  for insert
  with check (auth.uid() = owner_id);

drop policy if exists "Members can read diary books" on public.diary_books;
create policy "Members can read diary books"
  on public.diary_books
  for select
  using (
    auth.uid() = owner_id
    or exists (
      select 1
      from public.diary_book_members members
      where members.book_id = diary_books.id
        and members.user_id = auth.uid()
    )
  );

drop policy if exists "Owners can update diary books" on public.diary_books;
create policy "Owners can update diary books"
  on public.diary_books
  for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists "Members can read own memberships" on public.diary_book_members;
create policy "Members can read own memberships"
  on public.diary_book_members
  for select
  using (auth.uid() = user_id);

drop policy if exists "Owners can add themselves to diary books" on public.diary_book_members;
create policy "Owners can add themselves to diary books"
  on public.diary_book_members
  for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.diary_books books
      where books.id = diary_book_members.book_id
        and books.owner_id = auth.uid()
    )
  );

drop policy if exists "Users can read own diary entries" on public.diary_entries;
create policy "Users can read own diary entries"
  on public.diary_entries
  for select
  using (
    auth.uid() = user_id
    or exists (
      select 1
      from public.diary_book_members members
      where members.book_id = diary_entries.book_id
        and members.user_id = auth.uid()
    )
    or (
      book_id is null
      and exists (
        select 1
        from public.diary_book_members viewer
        join public.diary_book_members author
          on author.book_id = viewer.book_id
        where viewer.user_id = auth.uid()
          and author.user_id = diary_entries.user_id
      )
    )
  );

drop policy if exists "Users can insert own diary entries" on public.diary_entries;
create policy "Users can insert own diary entries"
  on public.diary_entries
  for insert
  with check (
    auth.uid() = user_id
    and (
      book_id is null
      or exists (
        select 1
        from public.diary_book_members members
        where members.book_id = diary_entries.book_id
          and members.user_id = auth.uid()
      )
    )
  );

drop policy if exists "Users can delete own diary entries" on public.diary_entries;
create policy "Users can delete own diary entries"
  on public.diary_entries
  for delete
  using (
    auth.uid() = user_id
    or exists (
      select 1
      from public.diary_books books
      where books.id = diary_entries.book_id
        and books.owner_id = auth.uid()
    )
  );

create or replace function public.join_diary_book_by_code(invite_code_input text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_book public.diary_books%rowtype;
  member_count integer;
begin
  if auth.uid() is null then
    raise exception 'login required';
  end if;

  select *
  into target_book
  from public.diary_books
  where invite_code = upper(trim(invite_code_input))
  limit 1;

  if target_book.id is null then
    return null;
  end if;

  select count(*)
  into member_count
  from public.diary_book_members
  where book_id = target_book.id;

  if member_count >= target_book.member_limit
    and not exists (
      select 1
      from public.diary_book_members
      where book_id = target_book.id
        and user_id = auth.uid()
    )
  then
    raise exception 'member limit reached';
  end if;

  insert into public.diary_book_members (book_id, user_id, role)
  values (target_book.id, auth.uid(), 'member')
  on conflict (book_id, user_id) do nothing;

  return target_book.id;
end;
$$;

create or replace function public.delete_empty_diary_book(book_id_input uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_book public.diary_books%rowtype;
  member_count integer;
  entry_count integer;
begin
  if auth.uid() is null then
    raise exception 'login required';
  end if;

  select *
  into target_book
  from public.diary_books
  where id = book_id_input
  limit 1;

  if target_book.id is null or target_book.owner_id <> auth.uid() then
    return false;
  end if;

  select count(*)
  into member_count
  from public.diary_book_members
  where book_id = target_book.id;

  select count(*)
  into entry_count
  from public.diary_entries
  where book_id = target_book.id;

  if member_count > 1 or entry_count > 0 then
    return false;
  end if;

  delete from public.diary_books
  where id = target_book.id
    and owner_id = auth.uid();

  return true;
end;
$$;

revoke execute on function public.delete_empty_diary_book(uuid) from anon;
grant execute on function public.delete_empty_diary_book(uuid) to authenticated;

create or replace function public.list_diary_entries_for_book(
  book_id_input uuid default null,
  limit_input integer default 60
)
returns table (
  id uuid,
  diary_date text,
  weather text,
  title text,
  place text,
  image_url text,
  image_path text,
  image_format text,
  created_at timestamptz,
  user_id uuid,
  book_id uuid,
  author_name text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'login required';
  end if;

  if book_id_input is null then
    return query
    select
      entries.id,
      entries.diary_date,
      entries.weather,
      entries.title,
      entries.place,
      entries.image_url,
      entries.image_path,
      entries.image_format,
      entries.created_at,
      entries.user_id,
      entries.book_id,
      coalesce(
        users.raw_user_meta_data->>'full_name',
        users.raw_user_meta_data->>'name',
        users.raw_user_meta_data->>'nickname',
        split_part(users.email, '@', 1),
        '친구'
      ) as author_name
    from public.diary_entries entries
    left join auth.users users
      on users.id = entries.user_id
    where entries.user_id = auth.uid()
      and entries.book_id is null
    order by entries.created_at desc
    limit least(greatest(coalesce(limit_input, 60), 1), 100);
    return;
  end if;

  if not exists (
    select 1
    from public.diary_book_members members
    where members.book_id = book_id_input
      and members.user_id = auth.uid()
  ) then
    raise exception 'not a book member';
  end if;

  return query
  select
    entries.id,
    entries.diary_date,
    entries.weather,
    entries.title,
    entries.place,
    entries.image_url,
    entries.image_path,
    entries.image_format,
    entries.created_at,
    entries.user_id,
    entries.book_id,
    coalesce(
      users.raw_user_meta_data->>'full_name',
      users.raw_user_meta_data->>'name',
      users.raw_user_meta_data->>'nickname',
      split_part(users.email, '@', 1),
      '친구'
    ) as author_name
  from public.diary_entries entries
  left join auth.users users
    on users.id = entries.user_id
  where entries.book_id = book_id_input
    or (
      entries.book_id is null
      and exists (
        select 1
        from public.diary_book_members members
        where members.book_id = book_id_input
          and members.user_id = entries.user_id
      )
    )
  order by entries.created_at desc
  limit least(greatest(coalesce(limit_input, 60), 1), 100);
end;
$$;

revoke execute on function public.list_diary_entries_for_book(uuid, integer) from public;
revoke execute on function public.list_diary_entries_for_book(uuid, integer) from anon;
grant execute on function public.list_diary_entries_for_book(uuid, integer) to authenticated;

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
    and (
      auth.uid()::text = (storage.foldername(name))[1]
      or exists (
        select 1
        from public.diary_entries entries
        join public.diary_book_members members
          on members.book_id = entries.book_id
        where entries.image_path = storage.objects.name
          and members.user_id = auth.uid()
      )
      or exists (
        select 1
        from public.diary_entries entries
        join public.diary_book_members viewer
          on viewer.user_id = auth.uid()
        join public.diary_book_members author
          on author.book_id = viewer.book_id
          and author.user_id = entries.user_id
        where entries.image_path = storage.objects.name
          and entries.book_id is null
      )
    )
  );

drop policy if exists "Users can delete own diary images" on storage.objects;
create policy "Users can delete own diary images"
  on storage.objects
  for delete
  using (
    bucket_id = 'diary-images'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

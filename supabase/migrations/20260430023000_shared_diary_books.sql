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

create index if not exists diary_entries_book_created_idx
  on public.diary_entries (book_id, created_at desc);

create index if not exists diary_book_members_user_idx
  on public.diary_book_members (user_id, book_id);

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
    )
  );

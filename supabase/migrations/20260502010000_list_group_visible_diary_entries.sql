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

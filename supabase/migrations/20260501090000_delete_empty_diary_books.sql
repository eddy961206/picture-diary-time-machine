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

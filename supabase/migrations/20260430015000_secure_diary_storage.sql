alter table public.diary_entries
  add column if not exists image_path text;

update storage.buckets
set public = false
where id = 'diary-images';

drop policy if exists "Users can read diary images" on storage.objects;
create policy "Users can read diary images"
  on storage.objects
  for select
  using (
    bucket_id = 'diary-images'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Kanso — the product image bucket.
--
-- One public bucket, `product-images`, for the derivatives the media agent
-- uploads. Created here because this repository has exactly one writer of SQL
-- and a bucket is schema: `supabase db reset` has to produce a working
-- database without anyone typing a raw command.
--
-- It is public because these are storefront photographs, not customer uploads.
-- The storefront itself renders from the committed `product-images/manifest.json`
-- rather than from Storage; `products.image_path` records the object for the
-- record. Nothing user-owned lives in this bucket, so `public = true` exposes
-- no data that is not already on the marketing site.
--
-- The media agent does not need to create this bucket. It uploads to
-- `product-images/<category>/<slug>-<ratio>-<width>.<ext>` and records the URLs
-- in the manifest.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  5242880, -- 5 MiB: a 640w WebP is tens of kilobytes; this is a ceiling, not a target
  array['image/webp', 'image/jpeg', 'image/png']
)
on conflict (id) do update
  set
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

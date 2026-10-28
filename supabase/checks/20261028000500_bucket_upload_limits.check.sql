-- Checks for 20261028000500_bucket_upload_limits.sql (task 1.6).

-- 1. BEFORE and AFTER: the bucket settings.
--    Expect after: plan-images 20971520 {image/jpeg,image/png,image/webp};
--                  project-media 52428800 {image/jpeg,image/png,image/webp,video/mp4,video/webm}.
select id, public, file_size_limit, allowed_mime_types
from storage.buckets
where id in ('plan-images', 'project-media')
order by id;

-- 2. For information: files already stored that the new rules would refuse
--    if uploaded today (they stay, but you may want to replace them).
select bucket_id, name,
       metadata->>'mimetype' as mimetype,
       (metadata->>'size')::bigint as size_bytes
from storage.objects
where (bucket_id = 'plan-images'
       and (coalesce(metadata->>'mimetype', '') not in ('image/jpeg', 'image/png', 'image/webp')
            or (metadata->>'size')::bigint > 20 * 1024 * 1024))
   or (bucket_id = 'project-media'
       and (coalesce(metadata->>'mimetype', '') not in ('image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm')
            or (metadata->>'size')::bigint > 50 * 1024 * 1024))
order by bucket_id, name;

-- 3. MANUAL TEST (on a Vercel preview, signed in as a TEST sub-admin, on a
--    TEST project):
--    a. Project page -> plan image: upload a .gif or .svg.  Expect: refused.
--    b. Upload a normal JPEG plan image.                   Expect: works.
--    c. Media: upload a .mov video.                        Expect: refused.
--    d. Media: upload a small .mp4.                        Expect: works.
--    Today's server upload path has a 10 MB request cap, so the 20 MB and
--    50 MB size limits can only be tested after Step 2 (browser uploads).

-- Cleanup after the manual test: delete the TEST sub-admin's uploaded files.
-- In the Dashboard -> Storage, open both buckets and delete the folder
-- named after the test sub-admin's user id. Then remove the media rows:
-- delete from public.project_media where project_id = '<test project id>';

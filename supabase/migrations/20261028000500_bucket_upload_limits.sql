-- Task 1.6: file size and type limits on the two public storage buckets.
--
-- Both buckets were created in 20260918100000_init_schema.sql with no
-- file_size_limit and no allowed_mime_types, so any file of any size and type
-- could be stored in them. Task 1.3 limits WHO can upload (active sub-admins
-- and admins); this limits WHAT can be uploaded. Storage enforces both on
-- every upload, including direct uploads from the browser.
--
-- plan-images   (site plans and floor plans): 20 MB, JPEG/PNG/WebP only.
--               PDFs are converted to PNG before upload (on the server
--               today, in the browser after Step 2), so they arrive as
--               image/png.
-- project-media (gallery photos and videos):   50 MB, JPEG/PNG/WebP, MP4/WebM.
--
-- SVG is deliberately not allowed in either bucket: both are public, and an
-- SVG opened directly from its storage URL can run scripts.
--
-- Limits apply to NEW uploads only. Files already stored (for example the
-- demo project's SVG site plan) are not touched and keep working.
-- Uploads of other types (GIF, HEIC, MOV, ...) will now fail with a storage
-- error; the file pickers still offer them until Step 2.
--
-- The project's global storage upload limit (Dashboard -> Storage ->
-- Settings) caps every bucket; if it is below 50 MB, project-media's limit
-- is effectively that lower value.
update storage.buckets
set file_size_limit = 20 * 1024 * 1024,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'plan-images';

update storage.buckets
set file_size_limit = 50 * 1024 * 1024,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm']
where id = 'project-media';

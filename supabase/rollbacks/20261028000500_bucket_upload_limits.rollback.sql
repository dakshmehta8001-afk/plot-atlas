-- Rollback for 20261028000500_bucket_upload_limits.sql (task 1.6).
-- Removes the size and type limits again (back to the init_schema state).
-- Note: this reopens the gap the migration closed.
update storage.buckets
set file_size_limit = null, allowed_mime_types = null
where id in ('plan-images', 'project-media');

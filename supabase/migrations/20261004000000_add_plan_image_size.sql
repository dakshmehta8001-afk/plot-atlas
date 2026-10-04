-- Pixel size of a project's plan image, stored when the image is uploaded.
-- The public map needs the image's shape to lay itself out; reading it from
-- the project row means the first render is already the right shape, instead of
-- waiting for the browser to download the image and measure it (which showed a
-- squashed map for a moment on slow connections).
--
-- Additive and nullable: existing projects keep null until backfilled, and the
-- map falls back to measuring the image in the browser when either is null.
alter table public.projects add column plan_image_width integer null check (plan_image_width > 0);
alter table public.projects add column plan_image_height integer null check (plan_image_height > 0);

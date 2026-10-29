# PlotAtlas fix plan

The full plan has not been added to the repo yet. This file holds notes for
later tasks until it is.

## Step 4

### 4.7
- Show the auto-send error after Google sign-in. In
  `src/components/map/ProjectMapClient.tsx`, the enquiry sent automatically
  after a viewer signs in with Google ignores `result.error`, so a refused
  enquiry (for example "You've already enquired about this unit." from task
  1.4) fails silently. Do this after `redesign-wip` is merged, because that
  branch also changes this file.

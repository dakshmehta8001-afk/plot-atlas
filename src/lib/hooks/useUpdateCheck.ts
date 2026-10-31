"use client";

import { useEffect, useRef, useState } from "react";

// Polls /api/version every `intervalMs` (default 60 s). Returns true once
// the server reports a build ID different from the one that was live when
// this hook first mounted — i.e. a new Vercel deployment has gone out.
export function useUpdateCheck(intervalMs = 60_000): boolean {
  const [hasUpdate, setHasUpdate] = useState(false);
  const initial = useRef<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const check = async () => {
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { build: string };
        if (initial.current === null) {
          initial.current = data.build;
        } else if (data.build !== initial.current) {
          if (mounted) setHasUpdate(true);
        }
      } catch {
        // Ignore network errors — the banner just won't appear if offline.
      }
    };

    check();
    const id = setInterval(check, intervalMs);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [intervalMs]);

  return hasUpdate;
}

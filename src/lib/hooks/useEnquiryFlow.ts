"use client";

// Shared "I'm interested" logic used by whichever card shows a unit's
// details to a viewer (UnitInfoCard for both plots and flats). Extracted
// into a hook so the enquiry flow (Google sign-in handoff for signed-out
// viewers, sessionStorage handoff across the redirect, submit) lives in
// exactly one place regardless of how the card around it is styled.
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { createLead } from "@/lib/actions/leads";

export const PENDING_ENQUIRY_KEY = "plot-atlas:pending-enquiry";

export type EnquiryState = "idle" | "submitting" | "sent" | "error";

export function useEnquiryFlow(unitId: string, isSignedIn: boolean, projectSlug: string) {
  const [message, setMessage] = useState("");
  const [state, setState] = useState<EnquiryState>("idle");
  const [errorText, setErrorText] = useState<string | null>(null);

  async function submit() {
    if (!isSignedIn) {
      // Remember what the viewer was asking about, then hand off to Google.
      // ProjectMapClient's effect replays this from sessionStorage once the
      // OAuth redirect lands the viewer back on this project page signed in.
      sessionStorage.setItem(PENDING_ENQUIRY_KEY, JSON.stringify({ unitId, message }));
      const supabase = createClient();
      const next = `/projects/${projectSlug}?intent=enquire&unit=${unitId}`;
      await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
      });
      return;
    }

    setState("submitting");
    const result = await createLead(unitId, message);
    if (result.error) {
      setState("error");
      setErrorText(result.error);
      return;
    }
    setState("sent");
  }

  return { message, setMessage, state, errorText, submit };
}

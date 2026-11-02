// Shown after a sub-admin signup request: explains the approval step.
import Link from "next/link";

export default function SignupPendingPage() {
  return (
    <div className="theme-survey paper-grid flex flex-1 text-[var(--ink)]">
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <div className="border-2 border-[var(--ink)] bg-white p-7 shadow-[var(--hard)] text-center">
        <h1 className="font-display font-bold text-[28px] leading-tight tracking-tight text-[var(--ink)]">Request received</h1>
        <p className="mt-2 text-sm text-[var(--ink-2)]">
          An admin will review your account. You can sign in and create projects once it is approved.
        </p>
        <Link
          href="/login"
          className="mt-6 inline-flex min-h-11 items-center rounded-full bg-[var(--accent)] px-5 font-label text-[13px] font-semibold uppercase tracking-[0.08em] text-[var(--accent-ink)] hover:bg-[var(--ink-2)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--signal)]"
        >
          Back to sign in
        </Link>
      </div>
    </main>
    </div>
  );
}

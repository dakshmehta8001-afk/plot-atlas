// Shown after a sub-admin signup request: explains the approval step.
import Link from "next/link";

export default function SignupPendingPage() {
  return (
    <div className="theme-paper flex flex-1 bg-[var(--paper)] text-[var(--ink)]">
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <div className="rounded-3xl border border-[var(--line)] bg-white p-8 shadow-[0_1px_2px_rgba(27,42,34,0.05),0_20px_40px_-24px_rgba(27,42,34,0.3)] text-center">
        <h1 className="font-display text-[28px] leading-tight tracking-tight text-[var(--ink)]">Request received</h1>
        <p className="mt-2 text-sm text-[var(--ink-2)]">
          An admin will review your account. You can sign in and create projects once it is approved.
        </p>
        <Link
          href="/login"
          className="mt-6 inline-flex min-h-11 items-center rounded-full bg-[var(--accent)] px-5 text-sm font-semibold text-[var(--accent-ink)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
        >
          Back to sign in
        </Link>
      </div>
    </main>
    </div>
  );
}

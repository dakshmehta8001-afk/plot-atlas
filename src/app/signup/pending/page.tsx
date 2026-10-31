// Shown after a sub-admin signup request: explains the approval step.
import Link from "next/link";

export default function SignupPendingPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <div className="rounded-3xl border border-white/10 bg-[var(--map-panel)] p-8 text-center shadow-[0_8px_40px_rgba(0,0,0,0.4)]">
        <h1 className="text-2xl font-bold tracking-tight text-white">Request received</h1>
        <p className="mt-2 text-sm text-white/55">
          An admin will review your account. You can sign in and create projects once it is approved.
        </p>
        <Link
          href="/login"
          className="mt-6 inline-flex min-h-11 items-center rounded-full bg-white px-5 text-sm font-semibold text-[#030712] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          Back to sign in
        </Link>
      </div>
    </main>
  );
}

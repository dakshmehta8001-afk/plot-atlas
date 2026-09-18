// Landed on right after a sub-admin signup submission. Tells the applicant
// what happens next (email confirmation, then admin approval) — they can't
// use the dashboard until both are done.
import Link from "next/link";

export default function SignupPendingPage() {
  return (
    <main className="mx-auto w-full max-w-sm px-4 py-16 text-center">
      <h1 className="mb-3 text-2xl font-semibold">Request received</h1>
      <p className="mb-6 text-sm text-gray-500">
        Please confirm your email using the link we sent you. Once confirmed, an admin still needs to approve
        your account before you can create a project — we&apos;ll be in touch.
      </p>
      <Link href="/login" className="text-sm underline">
        Back to login
      </Link>
    </main>
  );
}

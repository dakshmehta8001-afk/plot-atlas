import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-6 py-24 text-center">
      <p className="text-[13px] font-medium uppercase tracking-widest text-white/35">404</p>
      <h1 className="mt-2 text-2xl font-bold tracking-tight text-white">This page doesn’t exist</h1>
      <p className="mt-2 text-[15px] text-white/55">The project may have been unpublished or the link is mistyped.</p>
      <Link
        href="/"
        className="mt-8 inline-flex min-h-11 items-center rounded-full bg-white px-5 text-[14px] font-semibold text-[#030712] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
      >
        Back to projects
      </Link>
    </main>
  );
}

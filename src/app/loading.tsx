import { ProjectCardSkeleton } from "@/components/ui/ProjectCard";

export default function Loading() {
  return (
    <div className="theme-paper flex-1 bg-[var(--paper)]">
      <main className="mx-auto w-full max-w-6xl px-4 pb-20 pt-8 sm:px-6 sm:pt-14" aria-busy="true">
        <div className="mb-3 h-10 w-64 animate-pulse rounded bg-[var(--paper-2)] motion-reduce:animate-none" />
        <div className="mb-10 h-5 w-80 max-w-full animate-pulse rounded bg-[var(--paper-2)] motion-reduce:animate-none" />
        <div className="grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <ProjectCardSkeleton key={i} />
          ))}
        </div>
      </main>
    </div>
  );
}

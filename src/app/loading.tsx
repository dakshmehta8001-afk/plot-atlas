import { ProjectCardSkeleton } from "@/components/ui/ProjectCard";

export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-8 sm:px-6 sm:pt-14" aria-busy="true">
      <div className="mb-6 h-8 w-40 animate-pulse rounded bg-white/[0.07] motion-reduce:animate-none sm:mb-10" />
      <div className="mb-8 h-12 w-full animate-pulse rounded-full bg-white/[0.05] motion-reduce:animate-none" />
      <div className="grid grid-cols-1 gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <ProjectCardSkeleton key={i} />
        ))}
      </div>
    </main>
  );
}

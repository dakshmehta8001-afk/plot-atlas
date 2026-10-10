"use client";

// Small trigger that opens FloorFormModal — kept separate from the modal
// itself so the building page doesn't need to be a Client Component just to
// hold one bit of "is the modal open" state.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FloorFormModal } from "@/components/FloorFormModal";

export function AddFloorButton({ buildingId, projectId }: { buildingId: string; projectId: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 dark:bg-white dark:text-gray-900"
      >
        + Add floor
      </button>
      {open && (
        <FloorFormModal
          buildingId={buildingId}
          projectId={projectId}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

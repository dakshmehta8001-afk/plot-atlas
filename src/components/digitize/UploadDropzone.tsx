"use client";

// Step 1 of the flow: pick a file (drag-and-drop or browse), preview it,
// then explicitly confirm with "Start Digitization" — detection never runs
// automatically on file selection, both because OpenCV's WASM bundle is
// large enough that starting it eagerly would be wasteful if the user picks
// the wrong file, and because a manual "Run detection" trigger is what lets
// the whole pipeline stay on the main thread for v1 (see
// useDetectionPipeline.ts's doc comment) without freezing the tab the
// instant a file is dropped.
import { useEffect, useRef, useState } from "react";

const ACCEPTED_TYPES = ["image/jpeg", "image/jpg", "image/png", "application/pdf"];

export function UploadDropzone({ onStart }: { onStart: (file: File) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function acceptFile(candidate: File) {
    if (!ACCEPTED_TYPES.includes(candidate.type) && !candidate.name.toLowerCase().endsWith(".pdf")) {
      setError("That file type isn't supported — please upload a JPG, PNG, or PDF.");
      return;
    }
    setError(null);
    setFile(candidate);
  }

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file || file.type === "application/pdf") {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <div className="flex min-h-[500px] flex-col items-center justify-center gap-6 rounded-lg border border-gray-200 bg-white p-10 dark:border-gray-800 dark:bg-gray-900">
      <div className="text-center">
        <h2 className="text-xl font-semibold">Upload your layout plan</h2>
        <p className="mt-1 text-sm text-gray-500">Upload a site plan, plot map, brochure map, or scanned layout.</p>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const dropped = e.dataTransfer.files[0];
          if (dropped) acceptFile(dropped);
        }}
        onClick={() => inputRef.current?.click()}
        className={`flex w-full max-w-md cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-10 text-center transition-colors ${
          dragOver ? "border-gray-900 bg-gray-50 dark:border-white dark:bg-gray-800" : "border-gray-300 dark:border-gray-700"
        }`}
      >
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a transient local object URL preview, never a persisted/optimizable remote image
          <img src={previewUrl} alt="Selected plan preview" className="max-h-48 rounded-md object-contain" />
        ) : file ? (
          <p className="text-sm font-medium">{file.name} (PDF)</p>
        ) : (
          <>
            <p className="font-medium">Drop your map here or Browse</p>
            <p className="text-xs text-gray-400">JPG, JPEG, PNG, or PDF</p>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,application/pdf"
          className="hidden"
          onChange={(e) => {
            const selected = e.target.files?.[0];
            if (selected) acceptFile(selected);
          }}
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="button"
        disabled={!file}
        onClick={() => file && onStart(file)}
        className="rounded-md bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-gray-900"
      >
        Start Digitization
      </button>

      <p className="max-w-md text-center text-xs text-gray-400">
        Automatic detection + manual correction — this finds plots, roads, and areas as a starting point, then lets you
        review and fix anything it got wrong. It isn&apos;t a 100% automatic conversion.
      </p>
    </div>
  );
}

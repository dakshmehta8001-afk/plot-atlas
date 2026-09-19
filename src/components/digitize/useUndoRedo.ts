"use client";

// A plain snapshot-array undo/redo stack over the reviewer's in-progress
// shape list. No external state library — nothing else in this codebase
// uses one, and a linear history of full snapshots is simple enough for
// what's realistically a few dozen shapes at most.
import { useCallback, useRef, useState } from "react";

export function useUndoRedo<T>(initial: T) {
  const [present, setPresent] = useState(initial);
  const past = useRef<T[]>([]);
  const future = useRef<T[]>([]);
  const [, forceRender] = useState(0);

  const set = useCallback((next: T) => {
    past.current.push(present);
    future.current = [];
    setPresent(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `present` is read via the ref-like closure captured at call time, which is what we want (the value right before this change)
  }, [present]);

  const undo = useCallback(() => {
    const previous = past.current.pop();
    if (previous === undefined) return;
    future.current.push(present);
    setPresent(previous);
    forceRender((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [present]);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (next === undefined) return;
    past.current.push(present);
    setPresent(next);
    forceRender((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [present]);

  return {
    value: present,
    set,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
  };
}

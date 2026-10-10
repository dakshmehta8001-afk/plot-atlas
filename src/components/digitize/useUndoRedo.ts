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
  // past/future themselves stay as plain refs (mutated directly via
  // push/pop, never read during render) - only their LENGTH needs to be
  // real state, since canUndo/canRedo below are read during render and
  // must trigger a re-render when they change. Previously canUndo/canRedo
  // read past.current.length/future.current.length directly, which only
  // ever appeared to work because every call site also called setPresent
  // (or the old forceRender hack) right after mutating the refs - correct
  // by coincidence, not by the actual tracked dataflow. Explicit length
  // state removes that fragility and the forceRender workaround both.
  const [pastLength, setPastLength] = useState(0);
  const [futureLength, setFutureLength] = useState(0);

  const set = useCallback((next: T) => {
    past.current.push(present);
    future.current = [];
    setPastLength(past.current.length);
    setFutureLength(0);
    setPresent(next);
  }, [present]);

  const undo = useCallback(() => {
    const previous = past.current.pop();
    if (previous === undefined) return;
    future.current.push(present);
    setPresent(previous);
    setPastLength(past.current.length);
    setFutureLength(future.current.length);
  }, [present]);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (next === undefined) return;
    past.current.push(present);
    setPresent(next);
    setPastLength(past.current.length);
    setFutureLength(future.current.length);
  }, [present]);

  return {
    value: present,
    set,
    undo,
    redo,
    canUndo: pastLength > 0,
    canRedo: futureLength > 0,
  };
}

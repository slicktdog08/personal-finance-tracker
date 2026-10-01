"use client";

import { useEffect, useRef, useState } from "react";

// Native HTML5 drag-and-drop reordering. Reorders an optimistic local copy live while
// dragging, then persists the final id order via `onReorder` on drop/end. Re-syncs to
// server data when it changes (e.g. after router.refresh), except mid-drag.
export function useDragReorder<T extends { id: number }>(
  items: T[],
  onReorder: (orderedIds: number[]) => void,
) {
  const [order, setOrder] = useState<T[]>(items);
  const orderRef = useRef<T[]>(items);
  const dragId = useRef<number | null>(null);
  const moved = useRef(false);
  const [activeId, setActiveId] = useState<number | null>(null);

  useEffect(() => {
    orderRef.current = order;
  }, [order]);

  useEffect(() => {
    if (dragId.current == null) {
      setOrder(items);
      orderRef.current = items;
    }
    // Only re-sync from server when not actively dragging.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  function start(id: number) {
    dragId.current = id;
    moved.current = false;
    setActiveId(id);
  }

  function enter(overId: number) {
    const from = dragId.current;
    if (from == null || from === overId) return;
    setOrder((prev) => {
      const fromIdx = prev.findIndex((x) => x.id === from);
      const toIdx = prev.findIndex((x) => x.id === overId);
      if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return prev;
      const next = [...prev];
      const [m] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, m);
      moved.current = true;
      return next;
    });
  }

  function end() {
    const wasDragging = dragId.current != null;
    dragId.current = null;
    setActiveId(null);
    if (wasDragging && moved.current) {
      moved.current = false;
      onReorder(orderRef.current.map((x) => x.id));
    }
  }

  // Touch fallback: HTML5 drag events never fire on mobile, so tiles also get
  // up/down buttons that swap one position and persist immediately.
  function move(id: number, delta: -1 | 1) {
    const idx = orderRef.current.findIndex((x) => x.id === id);
    const to = idx + delta;
    if (idx === -1 || to < 0 || to >= orderRef.current.length) return;
    const next = [...orderRef.current];
    const [m] = next.splice(idx, 1);
    next.splice(to, 0, m);
    setOrder(next);
    orderRef.current = next;
    onReorder(next.map((x) => x.id));
  }

  // Props to spread on each draggable tile. `handleOnly` keeps the drag grab restricted to
  // the handle, so inline inputs/buttons stay usable.
  function tileProps(id: number) {
    return {
      onDragEnter: (e: React.DragEvent) => {
        e.preventDefault();
        enter(id);
      },
      onDragOver: (e: React.DragEvent) => e.preventDefault(),
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        end();
      },
    };
  }

  function handleProps(id: number) {
    return {
      draggable: true,
      onDragStart: (e: React.DragEvent) => {
        e.dataTransfer.effectAllowed = "move";
        // Some browsers require data to be set for a drag to begin.
        e.dataTransfer.setData("text/plain", String(id));
        start(id);
      },
      onDragEnd: () => end(),
    };
  }

  return { order, activeId, tileProps, handleProps, move };
}

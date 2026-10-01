"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { updateTransactionNotes } from "@/server/actions/transactions";

// The user's long-form explanation of a charge, shown under the bank's
// description and editable in place. Kept separate from EditTransaction so
// adding context to a row is one click and never re-validates/re-hashes the
// transaction — a note can't collide with the dedup hash the way a description
// edit can.
//
// Like CategoryCell, this deliberately does NOT call router.refresh() after
// saving: the local value is authoritative until the page reloads, so a row
// never jumps or disappears under an active filter while you're annotating it.
export function NoteCell({
  id,
  value,
  path,
  /** Collapsed height in lines before the note is clamped. */
  clampLines = 2,
}: {
  id: number;
  value: string | null;
  path: string;
  clampLines?: number;
}) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState(value ?? "");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [expanded, setExpanded] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  // Re-seed when the server sends a different value (refresh, re-sort, paging).
  // Adjusted during render — React's supported pattern for a prop-derived value
  // that also carries local edits — rather than in an effect.
  const [lastValue, setLastValue] = useState(value);
  if (lastValue !== value) {
    setLastValue(value);
    setNote(value ?? "");
  }

  useEffect(() => {
    if (editing) areaRef.current?.focus();
  }, [editing]);

  function open() {
    setDraft(note);
    setEditing(true);
  }

  function save() {
    const next = draft.trim();
    setNote(next);
    setEditing(false);
    start(async () => {
      await updateTransactionNotes(id, next || null, path);
    });
  }

  function cancel() {
    setDraft(note);
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="mt-1 space-y-1">
        <textarea
          ref={areaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") cancel();
            // Enter saves; Shift+Enter (or Alt/Ctrl) inserts a newline.
            if (e.key === "Enter" && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
              e.preventDefault();
              save();
            }
          }}
          rows={3}
          placeholder="What was this actually for?"
          className="w-full min-w-0 border rounded px-2 py-1 text-xs bg-transparent border-neutral-300 dark:border-neutral-700"
        />
        <div className="flex items-center gap-2">
          <button
            onClick={save}
            disabled={pending}
            className="text-xs text-blue-600 hover:underline disabled:opacity-50"
          >
            Save note
          </button>
          <button onClick={cancel} className="text-xs text-neutral-500 hover:underline">
            Cancel
          </button>
          <span className="text-[11px] text-neutral-400">Enter saves · Shift+Enter new line</span>
        </div>
      </div>
    );
  }

  if (!note) {
    return (
      <button
        onClick={open}
        title="Add a note explaining this transaction"
        className="mt-0.5 text-[11px] text-neutral-400 hover:text-blue-600 hover:underline"
      >
        + note
      </button>
    );
  }

  return (
    <div className="mt-0.5">
      <button
        onClick={open}
        title="Edit note"
        className="block text-left text-xs text-neutral-500 dark:text-neutral-400 whitespace-pre-wrap hover:text-blue-600"
        style={
          expanded
            ? undefined
            : {
                display: "-webkit-box",
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: clampLines,
                overflow: "hidden",
              }
        }
      >
        {note}
      </button>
      {/* Only worth offering when there's plausibly more than the clamp shows. */}
      {(note.length > 90 || note.includes("\n")) && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-[11px] text-neutral-400 hover:text-blue-600 hover:underline"
        >
          {expanded ? "less" : "more"}
        </button>
      )}
    </div>
  );
}

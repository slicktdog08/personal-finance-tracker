"use client";

import { useEffect, useRef, useState } from "react";

// The import-review twin of transactions/NoteCell: lets you explain a charge while
// you're still looking at the statement, instead of importing first and hunting the
// row down afterwards. The row isn't in the database yet, so unlike NoteCell this
// saves nowhere — it hands the text back to the wizard, which carries it on the
// PreviewRow and writes it to `transactions.notes` at commit.
export function ImportNoteCell({
  value,
  onChange,
  disabled = false,
  /** Collapsed height in lines before the note is clamped. */
  clampLines = 2,
}: {
  value: string | null | undefined;
  onChange: (next: string | null) => void;
  disabled?: boolean;
  clampLines?: number;
}) {
  const note = value ?? "";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note);
  const [expanded, setExpanded] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) areaRef.current?.focus();
  }, [editing]);

  function open() {
    setDraft(note);
    setEditing(true);
  }

  function save() {
    onChange(draft.trim() || null);
    setEditing(false);
  }

  function cancel() {
    setDraft(note);
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="mt-1 space-y-1">
        {/* 16px on phones so iOS doesn't zoom the page when the note is focused. */}
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
          className="w-full min-w-0 border rounded px-2 py-1 text-base md:text-xs bg-transparent border-neutral-300 dark:border-neutral-700"
        />
        <div className="flex items-center gap-2">
          <button onClick={save} className="text-xs text-blue-600 hover:underline">
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

  // Duplicate/error rows aren't imported, so a note on one would go nowhere. Any
  // text already typed still shows (the row may have flipped status since) — it
  // just can't be edited.
  if (disabled) {
    return note ? (
      <div className="mt-0.5 text-xs text-neutral-400 whitespace-pre-wrap">{note}</div>
    ) : null;
  }

  if (!note) {
    return (
      <button
        onClick={open}
        title="Add a note — it's saved with the transaction when you import"
        className="mt-0.5 inline-block py-1 text-xs text-neutral-400 hover:text-blue-600 hover:underline md:py-0 md:text-[11px]"
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

"use client";

import { useRef, useState } from "react";
import { SpinnerIcon, UploadIcon } from "@/components/icons";

/**
 * Polished, reusable upload surface: drag-and-drop plus a minimalistic "Choose file"
 * button, both feeding the same hidden <input>. Filters by `accept` on drop too, since
 * the browser only enforces the picker filter — dropped files bypass it.
 */
export function FileDropzone({
  accept,
  multiple = false,
  disabled = false,
  pending = false,
  pendingLabel = "Working…",
  title,
  hint,
  onFiles,
}: {
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  pending?: boolean;
  pendingLabel?: string;
  title: React.ReactNode;
  hint?: React.ReactNode;
  onFiles: (files: File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  // dragenter/leave fire per child element; count depth so nested targets don't flicker.
  const depth = useRef(0);
  const busy = disabled || pending;

  function accepts(file: File) {
    if (!accept) return true;
    const tokens = accept
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    if (!tokens.length) return true;
    const name = file.name.toLowerCase();
    const type = file.type.toLowerCase();
    return tokens.some((tok) => {
      if (tok.startsWith(".")) return name.endsWith(tok);
      if (tok.endsWith("/*")) return type.startsWith(tok.slice(0, -1));
      return type === tok;
    });
  }

  function pick(list: FileList | null) {
    if (!list) return;
    let files = Array.from(list).filter(accepts);
    if (!multiple) files = files.slice(0, 1);
    if (files.length) onFiles(files);
  }

  function open() {
    if (!busy) inputRef.current?.click();
  }

  const active = dragging && !busy;

  return (
    <div
      onDragEnter={(e) => {
        e.preventDefault();
        depth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        e.preventDefault();
        depth.current -= 1;
        if (depth.current <= 0) {
          depth.current = 0;
          setDragging(false);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        depth.current = 0;
        setDragging(false);
        if (!busy) pick(e.dataTransfer.files);
      }}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
      role="button"
      tabIndex={busy ? -1 : 0}
      aria-disabled={busy}
      className={`group relative flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed px-6 py-12 text-center outline-none transition-colors ${
        active
          ? "border-blue-500 bg-blue-50/70 dark:border-blue-500 dark:bg-blue-950/25"
          : "border-neutral-300 dark:border-neutral-700 hover:border-neutral-400 hover:bg-neutral-50 dark:hover:border-neutral-600 dark:hover:bg-neutral-900/50"
      } ${busy ? "cursor-not-allowed opacity-60" : "cursor-pointer"} focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-neutral-950`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={busy}
        onChange={(e) => {
          pick(e.target.files);
          e.target.value = ""; // let the same file re-trigger onChange next time
        }}
        className="hidden"
      />

      <span
        className={`flex h-14 w-14 items-center justify-center rounded-full transition-colors ${
          active
            ? "bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-300"
            : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
        }`}
      >
        {pending ? (
          <SpinnerIcon className="h-6 w-6" />
        ) : (
          <UploadIcon
            className={`h-6 w-6 transition-transform ${
              active ? "-translate-y-0.5" : "group-hover:-translate-y-0.5"
            }`}
          />
        )}
      </span>

      {pending ? (
        <div className="text-sm font-medium text-neutral-500">{pendingLabel}</div>
      ) : (
        <>
          <div className="space-y-1">
            <div className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
              {active ? "Drop to upload" : title}
            </div>
            {hint && <div className="text-xs text-neutral-500">{hint}</div>}
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              open();
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 shadow-sm transition-colors hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            <UploadIcon className="h-4 w-4" />
            Choose {multiple ? "files" : "file"}
          </button>
        </>
      )}
    </div>
  );
}

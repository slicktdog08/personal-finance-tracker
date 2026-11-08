"use client";

import { useRef, useState } from "react";
import { Button, Card, Icon, cx } from "@/components/ds";

/**
 * The kit's import drop zone (a dashed, sunken EmptyState inside a card), and a reusable upload
 * surface: drag-and-drop plus a minimalistic "Choose file"
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
    <Card padded={false}>
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
        aria-label={typeof title === "string" ? title : "Choose a file to import"}
        className={cx(
          "mp-empty m-5 rounded-[14px] border-[1.5px] border-dashed outline-none transition-colors max-md:m-3.5 md:max-w-md",
          active ? "border-accent bg-accent-soft" : "border-line-strong bg-sunken hover:bg-hover",
          busy ? "cursor-not-allowed opacity-60" : "cursor-pointer",
          "focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
        )}
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

        <div className="mp-empty__icon">
          <Icon name={pending ? "loader-circle" : "upload"} size={22} className={pending ? "mp-spinner" : undefined} />
        </div>

        {pending ? (
          <div className="mp-empty__title">{pendingLabel}</div>
        ) : (
          <>
            <div className="mp-empty__title">{active ? "Drop to upload" : title}</div>
            {hint && <div className="mp-empty__body">{hint}</div>}
            <div className="mp-empty__action">
              <Button
                variant="secondary"
                disabled={busy}
                onClick={(e) => {
                  e.stopPropagation();
                  open();
                }}
              >
                Choose {multiple ? "files" : "file"}
              </Button>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

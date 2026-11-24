"use client";

import { useEffect, useRef, useState } from "react";
import { Markdown } from "./Markdown";

/**
 * A reply the advisor is still writing. The run posts it in chunks (a section at a time), so
 * new text is revealed over a moment instead of appearing in jumps, with a caret at the end.
 * Respects reduced motion: then each chunk simply appears.
 */
export function StreamingMarkdown({ text }: { text: string }) {
  // Starts fully shown (what was already written when the page opened); only growth animates.
  const [shown, setShown] = useState(text.length);
  const progress = useRef(text.length);
  const frame = useRef<number | null>(null);
  const reduced = typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

  useEffect(() => {
    if (reduced) return;
    const target = text.length;
    const step = () => {
      const cur = Math.min(progress.current, target); // a replaced, shorter draft
      // About half a second for any chunk, never slower than 4 characters a frame.
      const next = cur >= target ? target : Math.min(target, cur + Math.max(4, Math.ceil((target - cur) / 30)));
      progress.current = next;
      setShown(next);
      frame.current = next < target ? requestAnimationFrame(step) : null;
    };
    frame.current = requestAnimationFrame(step);
    return () => {
      if (frame.current != null) cancelAnimationFrame(frame.current);
    };
  }, [text, reduced]);

  const visible = reduced ? text : text.slice(0, Math.min(shown, text.length));
  return (
    <div>
      <Markdown text={visible} />
      <span aria-hidden className="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 animate-pulse rounded-sm bg-fg-3" />
    </div>
  );
}

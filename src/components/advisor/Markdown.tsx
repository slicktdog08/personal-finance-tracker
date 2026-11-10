import { Fragment } from "react";

// A deliberately small markdown renderer for what the advisor writes: headings, paragraphs,
// bullet and numbered lists, fenced code, **bold**, *italic*, `code` and [links](https://…).
// It builds React elements (never innerHTML), so nothing in a reply can inject markup, and
// links only render for http(s) and same-app paths.

type Block =
  | { t: "h"; level: number; text: string }
  | { t: "p"; text: string }
  | { t: "ul" | "ol"; items: string[] }
  | { t: "code"; text: string }
  | { t: "hr" };

export function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ t: "p", text: para.join("\n") });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line)) {
      flush();
      const body: string[] = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) body.push(lines[i]);
      out.push({ t: "code", text: body.join("\n") });
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      out.push({ t: "h", level: h[1].length, text: h[2] });
      continue;
    }
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
      flush();
      out.push({ t: "hr" });
      continue;
    }
    const li = /^\s*([-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) {
      flush();
      const kind = /\d/.test(li[1]) ? "ol" : "ul";
      const last = out[out.length - 1];
      if (last && last.t === kind) last.items.push(li[2]);
      else out.push({ t: kind, items: [li[2]] });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    // A continuation line of a list item (indented) joins that item.
    const last = out[out.length - 1];
    if (!para.length && last && (last.t === "ul" || last.t === "ol") && /^\s{2,}\S/.test(line)) {
      last.items[last.items.length - 1] += " " + line.trim();
      continue;
    }
    para.push(line);
  }
  flush();
  return out;
}

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;

function safeHref(href: string): string | null {
  if (href.startsWith("/") && !href.startsWith("//")) return href;
  return /^https?:\/\//i.test(href) ? href : null;
}

function inline(text: string, key = ""): React.ReactNode[] {
  const parts = text.split(INLINE);
  return parts.map((part, i) => {
    const k = `${key}${i}`;
    if (!part) return null;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={k}>{inline(part.slice(2, -2), k)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={k} className="rounded bg-sunken px-1 py-px text-[0.92em]">{part.slice(1, -1)}</code>;
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (link) {
      const href = safeHref(link[2]);
      if (!href) return <Fragment key={k}>{link[1]}</Fragment>;
      const external = href.startsWith("http");
      return (
        <a key={k} href={href} className="text-accent-text underline underline-offset-2" {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
          {link[1]}
        </a>
      );
    }
    if ((part.startsWith("*") && part.endsWith("*")) || (part.startsWith("_") && part.endsWith("_"))) return <em key={k}>{part.slice(1, -1)}</em>;
    // Keep single line breaks inside a paragraph.
    const lines = part.split("\n");
    return lines.map((l, j) => (
      <Fragment key={`${k}-${j}`}>
        {j > 0 && <br />}
        {l}
      </Fragment>
    ));
  });
}

export function Markdown({ text, className = "" }: { text: string; className?: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className={`space-y-2 text-sm leading-relaxed break-words ${className}`}>
      {blocks.map((b, i) => {
        switch (b.t) {
          case "h": {
            const cls = b.level <= 2 ? "text-base font-semibold text-fg" : "text-sm font-semibold text-fg";
            return <p key={i} className={`${cls} pt-1`}>{inline(b.text)}</p>;
          }
          case "p":
            return <p key={i}>{inline(b.text)}</p>;
          case "ul":
            return (
              <ul key={i} className="list-disc space-y-1 pl-5">
                {b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}
              </ul>
            );
          case "ol":
            return (
              <ol key={i} className="list-decimal space-y-1 pl-5">
                {b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}
              </ol>
            );
          case "code":
            return (
              <pre key={i} className="overflow-x-auto rounded-lg bg-sunken p-3 text-xs leading-snug whitespace-pre-wrap">
                {b.text}
              </pre>
            );
          case "hr":
            return <hr key={i} className="border-line" />;
        }
      })}
    </div>
  );
}

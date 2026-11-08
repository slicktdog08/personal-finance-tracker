"use client";

// Browser side of Plaid Link: loads Plaid's script once and wraps Plaid.create in a promise
// per open. The link token is remembered in localStorage for the OAuth round trip — banks
// like Chase send the browser away and back to /settings/sync/plaid-oauth, where Link must be
// re-opened with the SAME token plus the URL it came back on.

const SCRIPT_SRC = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
const STORAGE_KEY = "plaid-link-pending";

export interface PlaidSuccessMetadata {
  institution: { name: string; institution_id: string } | null;
  accounts: { id: string; name: string; mask: string | null; type: string; subtype: string | null }[];
}

export interface PlaidExitError {
  error_code: string;
  error_message: string;
  display_message: string | null;
}

interface PlaidHandler {
  open: () => void;
  exit: (opts?: { force: boolean }) => void;
  destroy: () => void;
}

interface PlaidStatic {
  create: (config: {
    token: string;
    receivedRedirectUri?: string;
    onSuccess: (publicToken: string, metadata: PlaidSuccessMetadata) => void;
    onExit: (error: PlaidExitError | null) => void;
  }) => PlaidHandler;
}

declare global {
  interface Window {
    Plaid?: PlaidStatic;
  }
}

let loading: Promise<PlaidStatic> | null = null;

export function loadPlaid(): Promise<PlaidStatic> {
  if (window.Plaid) return Promise.resolve(window.Plaid);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT_SRC;
    s.async = true;
    s.onload = () => (window.Plaid ? resolve(window.Plaid) : reject(new Error("Plaid Link didn't load.")));
    s.onerror = () => {
      loading = null;
      reject(new Error("Couldn't load Plaid Link (blocked by the network or an extension?)."));
    };
    document.head.appendChild(s);
  });
  return loading;
}

export type LinkOutcome =
  | { kind: "success"; publicToken: string; metadata: PlaidSuccessMetadata }
  | { kind: "exit"; error: PlaidExitError | null };

// Plaid's iframe covers the screen but is mostly transparent around its dialog, so the app
// shows through as if Link were a widget on the page. While Link is open we dim and blur
// the app behind it and lock page scroll. The backdrop is plain DOM (not React) so every
// caller — the link button, Reconnect, the OAuth return page — gets it from here.
const BACKDROP_Z = 2147483000; // just under Plaid's iframe, which is raised to the max below
const PLAID_IFRAME = 'iframe[id^="plaid-link-iframe"]';

function showBackdrop(): () => void {
  const el = document.createElement("div");
  el.setAttribute("aria-hidden", "true");
  el.dataset.plaidBackdrop = "";
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  Object.assign(el.style, {
    position: "fixed",
    inset: "0",
    zIndex: String(BACKDROP_Z),
    background: "rgba(15, 23, 42, 0.6)",
    backdropFilter: "blur(6px)",
    opacity: "0",
    transition: reduceMotion ? "none" : "opacity 180ms ease-out",
  } satisfies Partial<CSSStyleDeclaration>);
  el.style.setProperty("-webkit-backdrop-filter", "blur(6px)"); // Safari
  document.body.appendChild(el);
  requestAnimationFrame(() => (el.style.opacity = "1"));

  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";

  // Make sure Plaid's frame sits above the backdrop whatever z-index it ships with.
  const raise = () => document.querySelectorAll<HTMLIFrameElement>(PLAID_IFRAME).forEach((f) => (f.style.zIndex = "2147483647"));
  raise();
  const observer = new MutationObserver(raise);
  observer.observe(document.body, { childList: true, subtree: true });

  return () => {
    observer.disconnect();
    document.body.style.overflow = prevOverflow;
    el.style.opacity = "0";
    window.setTimeout(() => el.remove(), reduceMotion ? 0 : 200);
  };
}

// Opens Link and resolves when the user finishes or closes it.
export async function openPlaidLink(token: string, receivedRedirectUri?: string): Promise<LinkOutcome> {
  const hide = showBackdrop();
  let Plaid: PlaidStatic;
  try {
    Plaid = await loadPlaid();
  } catch (e) {
    hide();
    throw e;
  }
  return new Promise((resolve) => {
    const finish = (outcome: LinkOutcome) => {
      hide();
      resolve(outcome);
      handler.destroy();
    };
    const handler = Plaid.create({
      token,
      receivedRedirectUri,
      onSuccess: (publicToken, metadata) => finish({ kind: "success", publicToken, metadata }),
      onExit: (error) => finish({ kind: "exit", error }),
    });
    handler.open();
  });
}

export interface PendingLink {
  linkToken: string;
  reconnectEnrollmentDbId?: number;
}

export function rememberPendingLink(p: PendingLink): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...p, at: Date.now() }));
  } catch {
    // private mode: an OAuth bank then has to be retried from the settings page
  }
}

export function takePendingLink(): PendingLink | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as PendingLink & { at: number };
    // Link tokens live 4 hours.
    if (!p.linkToken || Date.now() - p.at > 4 * 3600_000) return null;
    return p;
  } catch {
    return null;
  }
}

export function clearPendingLink(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function describeExit(error: PlaidExitError | null): string | null {
  if (!error) return null; // the user just closed Link
  return error.display_message || error.error_message || error.error_code;
}

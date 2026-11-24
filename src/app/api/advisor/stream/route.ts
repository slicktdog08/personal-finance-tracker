import { getSession } from "@/server/auth/session";
import { getThread, liveThreadState, sweepStale } from "@/server/lib/advisor/store";
import { isDemoMode } from "@/server/lib/demo/mode";

// Live chat: while a routine run answers a thread, push its progress to the open page as
// Server-Sent Events. The run writes through the MCP connector (stream_advisor_reply), so the
// database is the only shared channel — this polls it once a second server-side and sends an
// event only when something changed, which keeps the browser on a single open request instead
// of re-rendering the page on a timer.
//
//   event: state  data: LiveThreadState   (the run's activity + the newest messages)
//   event: done   data: {}                (nothing more is expected; the client refreshes)
//
// The stream ends on its own after MAX_MS (under nginx's 300s proxy_read_timeout); EventSource
// reconnects if the run is still going. nginx/template already has proxy_buffering off, and
// X-Accel-Buffering below covers any other nginx in front.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const TICK_MS = 1_000;
const MAX_MS = 4 * 60_000;
const PING_EVERY = 15;
const SWEEP_EVERY = 30;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function GET(request: Request): Promise<Response> {
  if (!(await getSession())) return new Response("Unauthorized", { status: 401 });
  const raw = new URL(request.url).searchParams.get("thread") ?? "";
  const threadId = /^\d{1,9}$/.test(raw) ? Number(raw) : 0;
  if (!threadId || isDemoMode()) return new Response("Not found", { status: 404 });
  if (!(await getThread(threadId))) return new Response("Not found", { status: 404 });

  const encoder = new TextEncoder();
  let closed = false;
  request.signal.addEventListener("abort", () => {
    closed = true;
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };
      const send = (event: string, data: unknown) => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

      write("retry: 3000\n\n");
      const started = Date.now();
      let last = "";
      let tick = 0;
      try {
        while (!closed && Date.now() - started < MAX_MS) {
          if (tick % SWEEP_EVERY === 0) await sweepStale();
          const state = await liveThreadState(threadId);
          const key = JSON.stringify([state.run, state.messages.map((m) => [m.id, m.status, m.body.length])]);
          if (key !== last) {
            send("state", state);
            last = key;
          } else if (tick % PING_EVERY === 0) {
            write(": ping\n\n");
          }
          if (!state.active) {
            send("done", {});
            break;
          }
          tick++;
          await sleep(TICK_MS);
        }
      } catch (err) {
        console.error("advisor stream error", err);
        send("error", { message: "The live view lost its connection; the page will refresh." });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed by the client
        }
      }
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

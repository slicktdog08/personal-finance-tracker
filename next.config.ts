import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // unpdf bundles a serverless pdf.js build; load it via native require on the server
  // instead of bundling it, which avoids worker/eval issues in the PDF import action.
  serverExternalPackages: ["unpdf"],
  experimental: {
    // PDF statements are base64-encoded (+~33%) and several can be uploaded at once;
    // the 1MB default Server Action body cap would reject realistic batches. The client
    // also guards per-file size/count, so this is a backstop, not the first wall hit.
    serverActions: { bodySizeLimit: "25mb" },
    // proxy.ts runs on every route, server actions included, and Next buffers a request body
    // for it only up to this size (default 10MB) — past that the body is silently TRUNCATED
    // and the action fails with a JSON parse error. Keep it above bodySizeLimit. nginx
    // (nginx/template*) allows 100m.
    proxyClientMaxBodySize: "30mb",
  },
  // Baseline hardening for a publicly-reachable app holding financial data. These
  // three are safe for this app specifically: it never frames itself, serves no
  // user-uploaded content inline, and has no cross-origin callers that need a full
  // referrer. A Content-Security-Policy is the notable gap — it needs per-deploy
  // nonce wiring, so it is left out rather than added in a form that silently
  // does nothing.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;

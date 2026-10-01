import "server-only";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "./schema";
import { parseDbUrl } from "@/server/lib/db-url";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "DATABASE_URL is not set. Add it to .env.local (see planning/design/03-architecture.md).",
  );
}

// Reuse the pool across hot-reloads in dev.
const globalForDb = globalThis as unknown as { __billingPool?: mysql.Pool };
const pool =
  globalForDb.__billingPool ??
  mysql.createPool({
    ...parseDbUrl(url),
    connectionLimit: 10,
    // The DB is remote over the public internet. The server's own idle timeout is
    // 8h, so it isn't killing connections — but stateful NAT/firewalls silently drop
    // idle TCP flows after a few minutes. When that happens the pool hands out a dead
    // socket and the next query fails with ECONNRESET / PROTOCOL_CONNECTION_LOST,
    // which surfaces as the misleading "Database not reachable" setup notice.
    //
    // TCP keepalive keeps the flow warm so firewalls never see it as idle, and a short
    // client-side idle timeout recycles connections before they can go stale.
    enableKeepAlive: true,
    keepAliveInitialDelay: 10_000, // start keepalive probes after 10s idle
    idleTimeout: 60_000, // close pooled conns idle >60s; reconnect fresh on next use
    maxIdle: 4,
  });
if (process.env.NODE_ENV !== "production") globalForDb.__billingPool = pool;

export const db = drizzle(pool, { schema, mode: "default" });
export { schema };

/**
 * Retakes the images in docs/screenshots/ from a running DEMO_MODE instance, so the docs
 * never show real data and can be refreshed after a UI change.
 *
 *   # 1. a scratch database with sample data, and the app in demo mode
 *   DEMO_MODE=1 DATABASE_URL=mysql://… npm run dev          (or the demo compose file)
 *   # 2. this script, pointed at it
 *   npx tsx scripts/screenshots.ts http://localhost:3000
 *
 * Needs `playwright-core` and a Chromium it can drive; neither is a project dependency:
 *   npm i --no-save playwright-core && npx playwright-core install chromium
 * (or set CHROME_PATH to any Chrome/Chromium binary).
 *
 * It signs in through the demo's pre-filled login form, and refuses to run against an
 * instance that isn't in demo mode — these pictures are published.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = join(__dirname, "..", "docs", "screenshots");

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

// [file, path, options]. `full` captures the whole page instead of the first screen.
const SHOTS: [string, string, { full?: boolean; phone?: boolean }?][] = [
  ["dashboard", "/dashboard"],
  ["dashboard-full", "/dashboard", { full: true }],
  ["bills", "/months"],
  ["transactions", "/transactions"],
  ["categorize", "/transactions/categorize"],
  ["import", "/import"],
  ["accounts", "/accounts"],
  ["debts", "/debts"],
  ["budget", "/budget"],
  ["goals", "/goals"],
  ["trends", "/trends"],
  ["cash", "/cash"],
  ["sync", "/settings/sync"],
  ["dashboard-phone", "/dashboard", { phone: true }],
  ["budget-phone", "/budget", { phone: true }],
];

async function main() {
  const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/+$/, "");
  // Resolved at run time so the project doesn't need playwright installed to typecheck.
  const moduleName = "playwright-core";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { chromium } = (await import(moduleName)) as any;
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
  mkdirSync(OUT, { recursive: true });

  try {
    for (const phone of [false, true]) {
      const context = await browser.newContext({
        viewport: phone ? PHONE : DESKTOP,
        deviceScaleFactor: 2,
        colorScheme: "light",
        isMobile: phone,
        hasTouch: phone,
      });
      // The launch splash plays once per browser session; mark it seen so no shot catches it.
      await context.addInitScript(() => {
        try {
          sessionStorage.setItem("mp-launched", "1"); // SPLASH_SEEN_KEY in src/lib/launch-splash.ts
        } catch {}
      });
      const page = await context.newPage();

      await page.goto(`${base}/login`, { waitUntil: "networkidle" });
      const demoButton = page.getByRole("button", { name: "Enter the demo" });
      if (!(await demoButton.count())) {
        throw new Error(`${base} is not in demo mode (no "Enter the demo" button). Refusing to photograph real data.`);
      }
      if (!phone) await page.screenshot({ path: join(OUT, "demo-sign-in.png") });
      await demoButton.click();
      await page.waitForURL(/\/dashboard/, { timeout: 30_000 });

      for (const [name, path, options] of SHOTS) {
        if (!!options?.phone !== phone) continue;
        await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
        // Entry fade (motion.css) and chart draw-in.
        await page.waitForTimeout(900);
        await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: !!options?.full });
        console.log(`✓ ${name}.png  ${path}`);
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

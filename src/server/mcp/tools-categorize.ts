import "server-only";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { and, asc, eq, gte, inArray, isNull, lte, or, type SQL } from "drizzle-orm";
import { fail, money, ok } from "./result";
import { db } from "@/server/db";
import { accounts, bills, categoryMappings, transactions } from "@/server/db/schema";
import { getCategoryOptionsRich } from "@/server/queries";
import { createRule, previewRuleDraft } from "@/server/actions/categorize";
import { setTransactionBill } from "@/server/actions/transactions";
import { backlogTimeline, groupBacklog, type BacklogRow } from "@/server/lib/backlog";
import { learnPlaces } from "@/server/lib/suggest";
import { toNum } from "@/server/lib/money";
import type { RuleInput } from "@/server/lib/categorize";

// Working through the uncategorized backlog in an advisor chat: two reads that turn thousands of
// rows into a few hundred merchant decisions (plus the timeline that explains them), and the two
// writes a decision needs — a rule that files a merchant (and can link it to a bill), and a direct
// bill link. Hand-set categories are never touched by any of them. See
// planning/features/categorization.md ("Categorizing history in the advisor chat").

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const uncategorized = () => or(isNull(transactions.category), eq(transactions.category, "")) as SQL;

async function accountNames(): Promise<Map<number, string>> {
  const rows = await db
    .select({ id: accounts.id, label: accounts.label, institution: accounts.institution, num: accounts.accountNumber })
    .from(accounts);
  return new Map(rows.map((a) => [a.id, a.label || [a.institution, a.num].filter(Boolean).join(" ") || `Account ${a.id}`]));
}

async function activeCategory(name: string): Promise<{ ok: true; name: string } | { ok: false; error: ReturnType<typeof fail> }> {
  const categories = await getCategoryOptionsRich();
  const match = categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (!match) return { ok: false, error: fail(`Unknown category "${name}".`, { known: categories.filter((c) => c.active).map((c) => c.name) }) };
  if (!match.active) return { ok: false, error: fail(`Category "${match.name}" is disabled in Settings.`) };
  return { ok: true, name: match.name };
}

/** The whole ledger's descriptions + categories (one pass; ~tens of thousands of short rows). */
async function ledger(where?: SQL) {
  const rows = await db
    .select({
      id: transactions.id,
      description: transactions.description,
      category: transactions.category,
      txnDate: transactions.txnDate,
      amount: transactions.amount,
      direction: transactions.direction,
      accountId: transactions.accountId,
    })
    .from(transactions)
    .where(where);
  return rows.map((r) => ({ ...r, amount: toNum(r.amount) ?? 0, category: r.category || null }));
}

export function registerCategorizeTools(server: McpServer) {
  server.registerTool(
    "get_categorization_overview",
    {
      title: "Uncategorized backlog: overview",
      description:
        "The big picture before categorizing history: how many transactions are uncategorized (by year and by account), a month-by-month timeline with the places named in that month's descriptions (a run of months in another city usually means the user lived or travelled there — ask), the active categories, the bills with their ids (for bill links), and how many saved rules exist. Read-only.",
      inputSchema: z.object({}),
      annotations: READ_ONLY,
    },
    async () => {
      const [rows, names, categories, billRows, ruleRows] = await Promise.all([
        ledger(),
        accountNames(),
        getCategoryOptionsRich(),
        db
          .select({ id: bills.id, name: bills.name, category: bills.category, defaultAmount: bills.defaultAmount, active: bills.active, isDebt: bills.isDebt })
          .from(bills)
          .orderBy(asc(bills.name)),
        db.select({ id: categoryMappings.id }).from(categoryMappings),
      ]);
      const places = learnPlaces(rows.map((r) => r.description));
      const uncats = rows.filter((r) => !r.category);

      const byYear = new Map<string, { total: number; uncategorized: number }>();
      for (const r of rows) {
        const y = r.txnDate.slice(0, 4);
        const e = byYear.get(y) ?? { total: 0, uncategorized: 0 };
        e.total++;
        if (!r.category) e.uncategorized++;
        byYear.set(y, e);
      }
      const byAccount = new Map<number | null, number>();
      for (const r of uncats) byAccount.set(r.accountId, (byAccount.get(r.accountId) ?? 0) + 1);

      return ok({
        totalTransactions: rows.length,
        uncategorized: uncats.length,
        byYear: [...byYear].sort((a, b) => a[0].localeCompare(b[0])).map(([year, e]) => ({ year, ...e })),
        byAccount: [...byAccount]
          .sort((a, b) => b[1] - a[1])
          .map(([accountId, n]) => ({ accountId, account: accountId == null ? null : (names.get(accountId) ?? null), uncategorized: n })),
        timeline: backlogTimeline(
          rows.map((r) => ({ description: r.description, txnDate: r.txnDate, uncategorized: !r.category })),
          { places },
        ).filter((m) => m.uncategorized > 0 || m.places.length > 0),
        categories: categories.filter((c) => c.active).map((c) => c.name),
        bills: billRows.map((b) => ({ billId: b.id, name: b.name, category: b.category, defaultAmount: money(b.defaultAmount), active: b.active, isDebt: b.isDebt })),
        savedRules: ruleRows.length,
      });
    },
  );

  server.registerTool(
    "get_uncategorized_groups",
    {
      title: "Uncategorized backlog: merchant groups",
      description:
        "Uncategorized transactions grouped by merchant, biggest groups first — the unit to decide on. Each group: the merchant `pattern` (the default rule pattern), count, money out/in, amount range, first/last date, months seen, `monthly` (charged about monthly — likely a subscription or bill), accounts, sample descriptions, places, the transaction ids, and `lookalikes` (what already-categorized descriptions containing the pattern are filed under — strong evidence when it's lopsided). Page with offset/limit; narrow with dates, accounts, direction or search. Read-only.",
      inputSchema: z.object({
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(80).default(30),
        minCount: z.number().int().min(1).default(1).describe("Skip groups smaller than this."),
        from: isoDate.optional().describe("Only rows on/after this date."),
        to: isoDate.optional().describe("Only rows on/before this date."),
        accountIds: z.array(z.number().int()).optional(),
        direction: z.enum(["Debit", "Credit"]).optional(),
        search: z.string().max(80).optional().describe("Only groups whose pattern or descriptions contain this text."),
        idsPerGroup: z.number().int().min(0).max(200).default(40).describe("How many transaction ids to list per group."),
      }),
      annotations: READ_ONLY,
    },
    async ({ offset, limit, minCount, from, to, accountIds, direction, search, idsPerGroup }) => {
      const conds: SQL[] = [uncategorized()];
      if (from) conds.push(gte(transactions.txnDate, from));
      if (to) conds.push(lte(transactions.txnDate, to));
      if (accountIds?.length) conds.push(inArray(transactions.accountId, accountIds));
      if (direction) conds.push(eq(transactions.direction, direction));
      const [all, names] = await Promise.all([ledger(), accountNames()]);
      const backlog = await ledger(and(...conds));
      const places = learnPlaces(all.map((r) => r.description));
      const categorized = all.filter((r) => r.category).map((r) => ({ description: r.description, category: r.category as string }));

      let groups = groupBacklog(backlog as BacklogRow[], categorized, { places, idCap: idsPerGroup });
      groups = groups.filter((g) => g.count >= minCount);
      if (search?.trim()) {
        const needle = search.trim().toUpperCase();
        groups = groups.filter((g) => g.pattern.toUpperCase().includes(needle) || g.samples.some((s) => s.toUpperCase().includes(needle)));
      }
      const page = groups.slice(offset, offset + limit);
      return ok({
        uncategorizedMatching: backlog.length,
        totalGroups: groups.length,
        offset,
        nextOffset: offset + page.length < groups.length ? offset + page.length : null,
        rowsInThisPage: page.reduce((s, g) => s + g.count, 0),
        groups: page.map((g) => ({
          ...g,
          accounts: g.accounts.map((a) => ({ ...a, account: a.accountId == null ? null : (names.get(a.accountId) ?? null) })),
        })),
      });
    },
  );

  server.registerTool(
    "categorize_with_rule",
    {
      title: "Save a categorization rule and apply it",
      description:
        "Save a rule (description contains/equals/regex `pattern`, optionally limited to an account, direction or amount range) that sets `category` and/or links `billId`, then apply it to every UNCATEGORIZED matching transaction (and links unlinked ones to the bill). Future imports and syncs follow it too. Transactions already categorized are never changed. Same conditions as an existing rule = that rule is updated, not duplicated. `dryRun: true` only reports what it would do, including `elsewhere`: already-categorized matches in OTHER categories — if that's large the pattern is too broad (a city, a bank phrase); narrow it. Ask the user before calling without dryRun. Undo: the app's rule editor deletes a rule and can clear what it set.",
      inputSchema: z.object({
        pattern: z.string().min(3).max(255).describe("Usually a group's `pattern` from get_uncategorized_groups, verbatim."),
        matchType: z.enum(["contains", "equals", "regex"]).default("contains"),
        category: z.string().min(1).optional().describe("Active category name from get_categorization_overview."),
        billId: z.number().int().optional().describe("Also link matches to this bill (from get_categorization_overview's bills)."),
        accountId: z.number().int().optional().describe("Only on this account."),
        direction: z.enum(["Debit", "Credit"]).optional().describe("Only money out (Debit) or in (Credit)."),
        amountMin: z.number().min(0).optional(),
        amountMax: z.number().min(0).optional(),
        dryRun: z.boolean().default(false),
      }),
      annotations: WRITE,
    },
    async ({ pattern, matchType, category, billId, accountId, direction, amountMin, amountMax, dryRun }) => {
      const text = pattern.trim();
      if (!category && billId == null) return fail("A rule needs a category, a billId, or both.");
      if (matchType !== "regex" && !/[A-Za-z]{2,}/.test(text)) return fail(`"${text}" has no merchant name in it; a rule on it would match unrelated transactions.`);
      if (matchType === "regex") {
        try {
          new RegExp(text, "i");
        } catch {
          return fail(`"${text}" isn't a valid regular expression.`);
        }
      }
      if (amountMin != null && amountMax != null && amountMin > amountMax) return fail("amountMin is above amountMax.");
      let cat: string | null = null;
      if (category) {
        const c = await activeCategory(category);
        if (!c.ok) return c.error;
        cat = c.name;
      }
      if (billId != null) {
        const [b] = await db.select({ id: bills.id }).from(bills).where(eq(bills.id, billId)).limit(1);
        if (!b) return fail(`No bill ${billId}. get_categorization_overview lists the bills.`);
      }
      if (accountId != null) {
        const [a] = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, accountId)).limit(1);
        if (!a) return fail(`No account ${accountId}.`);
      }

      const input: RuleInput = {
        matchType,
        pattern: text,
        field: "description",
        accountId: accountId ?? null,
        direction: direction ?? null,
        amountMin: amountMin ?? null,
        amountMax: amountMax ?? null,
        category: cat,
        billId: billId ?? null,
      };
      const preview = await previewRuleDraft(input);
      if (dryRun) return ok({ dryRun: true, wouldCategorize: preview.categorized, wouldLink: preview.linked, samples: preview.samples, elsewhere: preview.elsewhere });

      const res = await createRule(input);
      return ok({
        ruleId: res.rule.id,
        pattern: res.rule.pattern,
        category: res.rule.category,
        billId: res.rule.billId,
        categorized: res.categorized,
        linked: res.linked,
        elsewhere: preview.elsewhere,
      });
    },
  );

  server.registerTool(
    "link_transactions_to_bill",
    {
      title: "Link transactions to a bill",
      description:
        "Record transactions as payments of a recurring bill (each is also attached to that bill's instance in its own month when one exists), or pass billId null to unlink them. A hand-made link: no rule will later move it. For every future payment of the same merchant too, use categorize_with_rule with billId instead. Returns before → after. Ask the user before calling.",
      inputSchema: z.object({
        transactionIds: z.array(z.number().int()).min(1).max(200),
        billId: z.number().int().nullable(),
      }),
      annotations: WRITE,
    },
    async ({ transactionIds, billId }) => {
      let billName: string | null = null;
      if (billId != null) {
        const [b] = await db.select({ id: bills.id, name: bills.name }).from(bills).where(eq(bills.id, billId)).limit(1);
        if (!b) return fail(`No bill ${billId}. get_categorization_overview lists the bills.`);
        billName = b.name;
      }
      const ids = [...new Set(transactionIds)];
      const before = await db
        .select({ id: transactions.id, description: transactions.description, txnDate: transactions.txnDate, billId: transactions.billId })
        .from(transactions)
        .where(inArray(transactions.id, ids));
      const missing = ids.filter((id) => !before.some((b) => b.id === id));
      if (missing.length) return fail(`No transaction with id ${missing.join(", ")}.`);

      const changed: number[] = [];
      for (const t of before) {
        if (t.billId === billId) continue;
        const r = await setTransactionBill(t.id, billId, "/transactions");
        if (!r.ok) return fail(`Stopped at transaction ${t.id}: ${r.error}`, { alreadyChanged: changed });
        changed.push(t.id);
      }
      return ok({
        billId,
        bill: billName,
        changed: changed.length,
        unchanged: before.length - changed.length,
        transactions: before.map((b) => ({ transactionId: b.id, date: b.txnDate, description: b.description, previousBillId: b.billId })),
      });
    },
  );
}

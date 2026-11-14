import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { robinhoodBrokerageParser } from "@/server/lib/pdf/parsers/robinhood-brokerage";
import { robinhoodCryptoParser } from "@/server/lib/pdf/parsers/robinhood-crypto";
import { robinhoodParser } from "@/server/lib/pdf/parsers/robinhood";
import { detectAndParse } from "@/server/lib/pdf/registry";
import { positionRows, tradeHashes, tradeRows } from "@/server/lib/pdf/investments";
import { groupItemsToLines, type PositionedItem } from "@/server/lib/pdf/lines";
import type { ParserResult } from "@/server/lib/pdf/types";

// Positioned text as pdf.js reports it for a brokerage statement. Illustrative values only.
// Column x positions mirror the real layout: each cell starts at its heading's x.
const X = { desc: 37, symbol: 223, acct: 282, txn: 356, date: 441, qty: 526, price: 562, debit: 626, credit: 693 };
const at = (y: number, cells: Partial<Record<keyof typeof X, string>>): PositionedItem[] =>
  Object.entries(cells).map(([k, str]) => ({ str: str!, x: X[k as keyof typeof X], y }));

const HEADING = (y: number) =>
  at(y, {
    desc: "Description",
    symbol: "Symbol",
    acct: "Acct Type",
    txn: "Transaction",
    date: "Date",
    qty: "Qty",
    price: "Price",
    debit: "Debit",
    credit: "Credit",
  });

const SUMMARY: PositionedItem[] = [
  { str: "Page 1 of 3", x: 712, y: 590 },
  { str: "85 Example Rd, Anytown, CA 00000", x: 37, y: 560 },
  { str: "05/01/2026 to 05/31/2026", x: 600, y: 560 },
  { str: "help@robinhood.com", x: 37, y: 548 },
  { str: "PAT EXAMPLE", x: 400, y: 548 },
  { str: "Account #:111112222", x: 600, y: 548 },
  { str: "Account Summary", x: 37, y: 500 },
  { str: "Opening Balance", x: 300, y: 500 },
  { str: "Closing Balance", x: 400, y: 500 },
  { str: "Net Account Balance", x: 37, y: 480 },
  { str: "($100.00)", x: 300, y: 480 },
  { str: "$250.00", x: 400, y: 480 },
  { str: "Portfolio Value", x: 37, y: 460 },
  { str: "$1,000.00", x: 300, y: 460 },
  { str: "$1,500.00", x: 400, y: 460 },
];

// Portfolio Summary: name above the row, yield below, a different set of columns.
const H = { name: 37, sym: 184, acct: 255, qty: 321, price: 395, value: 462, pct: 647 };
const HOLDINGS: PositionedItem[] = [
  { str: "Portfolio Summary", x: 37, y: 559 },
  { str: "Securities Held in Account", x: H.name, y: 523 },
  { str: "Sym/Cusip", x: H.sym, y: 523 },
  { str: "Acct Type", x: H.acct, y: 523 },
  { str: "Qty", x: H.qty, y: 523 },
  { str: "Price", x: H.price, y: 523 },
  { str: "Mkt Value", x: H.value, y: 523 },
  { str: "% of Total Portfolio", x: H.pct, y: 523 },
  { str: "Acme Corp", x: H.name, y: 500 },
  { str: "ACME", x: H.sym, y: 496 },
  { str: "Margin", x: H.acct, y: 496 },
  { str: "10.5", x: H.qty, y: 496 },
  { str: "$21.00", x: H.price, y: 496 },
  { str: "$220.50", x: H.value, y: 496 },
  { str: "14.70%", x: H.pct, y: 496 },
  { str: "Estimated Yield: 1.00%", x: H.name, y: 492 },
  { str: "ACME 06/19/2026 Call $25.00", x: H.name, y: 471 },
  { str: "ACME", x: H.sym, y: 467 },
  { str: "Margin", x: H.acct, y: 467 },
  { str: "1", x: H.qty, y: 467 },
  { str: "$0.40", x: H.price, y: 467 },
  { str: "$40.00", x: H.value, y: 467 },
  { str: "Total Securities", x: H.name, y: 440 },
  { str: "$260.50", x: H.value, y: 440 },
  { str: "17.37%", x: H.pct, y: 440 },
];

const ACTIVITY: PositionedItem[] = [
  { str: "Page 2 of 3", x: 712, y: 590 },
  { str: "Account Activity", x: 37, y: 523 },
  ...HEADING(489),
  // A fee: one amount, under Debit. Its second description line sits below the row's baseline.
  { str: "Aggregated Margin Interest", x: X.desc, y: 465 },
  ...at(462, { acct: "Margin", txn: "MINT", date: "05/07/2026", debit: "$11.00" }),
  { str: "2.5% APR", x: X.desc, y: 458 },
  // A card purchase and a deposit — same shape, opposite columns.
  ...at(436, { desc: "COFFEE SHOP ANYTOWN, CA", acct: "Margin", txn: "CARD", date: "05/08/2026", debit: "$4.00" }),
  ...at(411, { desc: "ACH Deposit", acct: "Margin", txn: "ACH", date: "05/09/2026", credit: "$500.00" }),
  // A buy: the security's name above the row, its CUSIP below.
  { str: "Acme Corp", x: X.desc, y: 389 },
  ...at(385, { symbol: "ACME", acct: "Margin", txn: "Buy", date: "05/10/2026", qty: "10", price: "$20.00", debit: "$200.00" }),
  { str: "CUSIP: 000000000", x: X.desc, y: 381 },
  // An option expiring: a quantity, no cash at all.
  ...at(360, { desc: "ACME 05/15/2026 Call $25.00", acct: "Margin", txn: "OEXP", date: "05/15/2026", qty: "1S" }),
  // Cash sent to the crypto account: no quantity, still not spending.
  ...at(335, { desc: "Crypto Money Movement", acct: "Margin", txn: "COIN", date: "05/16/2026", debit: "$50.00" }),
  ...at(310, { desc: "Total Funds Paid and Received", debit: "$265.00", credit: "$560.00" }),
  // The look-alike table below must be ignored.
  { str: "Executed Trades Pending Settlement", x: 37, y: 296 },
  { str: "Description", x: 37, y: 254 },
  { str: "Acct Type", x: 185, y: 254 },
  { str: "Transaction", x: 273, y: 254 },
  { str: "Trade Date", x: 353, y: 254 },
  { str: "Settle Date", x: 434, y: 254 },
  { str: "Qty", x: 511, y: 254 },
  { str: "Price", x: 573, y: 254 },
  { str: "Debit", x: 643, y: 254 },
  { str: "Credit", x: 688, y: 254 },
  { str: "Acme Corp", x: 37, y: 231 },
  { str: "Margin", x: 185, y: 227 },
  { str: "Sell", x: 273, y: 227 },
  { str: "05/29/2026", x: 353, y: 227 },
  { str: "06/01/2026", x: 434, y: 227 },
  { str: "1", x: 511, y: 227 },
  { str: "$21.00", x: 573, y: 227 },
  { str: "$21.00", x: 688, y: 227 },
];

// The table's last row lands on the next page, under a repeated heading.
const ACTIVITY_P2: PositionedItem[] = [
  { str: "Page 3 of 3", x: 712, y: 590 },
  ...HEADING(560),
  ...at(540, { desc: "Cash Div: 10 shares at 0.60", symbol: "ACME", acct: "Margin", txn: "CDIV", date: "05/20/2026", credit: "$60.00" }),
];

function run(pages: PositionedItem[][]): ParserResult {
  const lines = pages.flatMap((p) => groupItemsToLines(p));
  const { parser, results } = detectAndParse(lines, lines.join("\n"), pages);
  assert.equal(parser, robinhoodBrokerageParser);
  assert.equal(results.length, 1);
  return results[0];
}

describe("Robinhood brokerage statement", () => {
  // Move the totals line to the continuation page so the table spans both.
  const total = ACTIVITY.filter((i) => i.y === 310);
  const page2 = ACTIVITY.filter((i) => i.y > 310);
  const tail = ACTIVITY.filter((i) => i.y < 310);
  const pages = [SUMMARY, HOLDINGS, page2, [...ACTIVITY_P2, ...total.map((i) => ({ ...i, y: 515 })), ...tail]];
  const r = run(pages);

  test("reads the header: brokerage number, period and portfolio value", () => {
    assert.equal(r.meta.accountNumber, "2222");
    assert.equal(r.meta.accountType, "Investment");
    assert.equal(r.meta.periodStart, "2026-05-01");
    assert.equal(r.meta.periodEnd, "2026-05-31");
    assert.equal(r.meta.openingBalance, 1000);
    assert.equal(r.meta.closingBalance, 1500);
  });

  test("takes debit vs credit from the column the amount sits under", () => {
    assert.deepEqual(
      r.txns.map((t) => [t.dateIso, t.direction, t.amount, t.raw.type]),
      [
        ["2026-05-07", "Debit", 11, "MINT"],
        ["2026-05-08", "Debit", 4, "CARD"],
        ["2026-05-09", "Credit", 500, "ACH"],
        ["2026-05-20", "Credit", 60, "CDIV"],
      ],
    );
  });

  test("joins a description that wraps above and below its row", () => {
    assert.equal(r.txns[0].description, "Aggregated Margin Interest 2.5% APR");
    assert.equal(r.txns[3].raw.symbol, "ACME");
  });

  test("returns trades, expirations and crypto moves as trades, never as transactions", () => {
    assert.ok(!r.txns.some((t) => ["Buy", "OEXP", "COIN", "Sell"].includes(t.raw.type)));
    assert.deepEqual(r.trades, [
      {
        dateIso: "2026-05-10",
        kind: "buy",
        action: "Buy",
        assetClass: "equity",
        symbol: "ACME",
        name: "Acme Corp",
        quantity: 10,
        price: 20,
        amount: 200,
        direction: "Debit",
      },
      {
        dateIso: "2026-05-15",
        kind: "other",
        action: "OEXP",
        assetClass: "option",
        symbol: null,
        name: "ACME 05/15/2026 Call $25.00",
        quantity: -1, // "1S": the contract left the account
        price: null,
        amount: null,
        direction: null,
      },
      {
        dateIso: "2026-05-16",
        kind: "other",
        action: "COIN",
        assetClass: "cash",
        symbol: null,
        name: "Crypto Money Movement",
        quantity: null,
        price: null,
        amount: 50,
        direction: "Debit",
      },
    ]);
    assert.deepEqual(r.notes, []);
  });

  test("a sale's quantity is negative even when the statement prints it bare", () => {
    const sold = run(
      pages.map((p) =>
        p.map((i) => (i.str === "Buy" ? { ...i, str: "Sell" } : i.y === 385 && i.x === X.debit ? { ...i, x: X.credit } : i)),
      ),
    );
    const t = sold.trades!.find((x) => x.action === "Sell")!;
    assert.equal(t.kind, "sell");
    assert.equal(t.quantity, -10);
    assert.equal(t.direction, "Credit");
  });

  test("reads the holdings at the close, option contracts included", () => {
    assert.deepEqual(r.positions, [
      { assetClass: "equity", symbol: "ACME", name: "Acme Corp", quantity: 10.5, price: 21, marketValue: 220.5 },
      {
        assetClass: "option",
        symbol: "ACME",
        name: "ACME 06/19/2026 Call $25.00",
        quantity: 1,
        price: 0.4,
        marketValue: 40,
      },
    ]);
  });

  test("holdings that don't reach the printed total fail the statement", () => {
    const bad = run(pages.map((p) => p.map((i) => (i.str === "$260.50" ? { ...i, str: "$999.00" } : i))));
    assert.equal(bad.reconciled, false);
    assert.match(bad.notes.join("\n"), /Holdings read as \$260\.50/);
  });

  test("reconciles every row, imported or not, against the printed totals", () => {
    assert.equal(r.reconciled, true);
  });

  test("flags a statement whose rows don't reach the printed totals", () => {
    const short = pages.map((p) => p.filter((i) => !(i.y === 436 && p === page2)));
    const bad = run(short);
    assert.equal(bad.reconciled, false);
    assert.match(bad.notes.join("\n"), /some rows may have been misread/);
  });

  test("prefers the brokerage number over the cash-management routing number", () => {
    const withAch = [
      [{ str: "Cash Management ACH Account #:999988887777", x: 600, y: 572 }, ...SUMMARY],
      ...pages.slice(1),
    ];
    assert.equal(run(withAch).meta.accountNumber, "2222");
  });

  test("a masked account number still yields its last four", () => {
    const masked = [
      SUMMARY.map((i) => (i.str.startsWith("Account #:") ? { ...i, str: "Individual Account #:*****2222" } : i)),
      ...pages.slice(1),
    ];
    assert.equal(run(masked).meta.accountNumber, "2222");
  });

  test("a statement with no activity table records the value alone", () => {
    const quiet = run([SUMMARY.map((i) => (i.str === "$1,000.00" ? { ...i, str: "N/A" } : i))]);
    assert.equal(quiet.txns.length, 0);
    assert.equal(quiet.meta.openingBalance, null);
    assert.equal(quiet.meta.closingBalance, 1500);
    assert.equal(quiet.reconciled, null);
  });
});

describe("Robinhood crypto statement", () => {
  const LINES = [
    "Crypto Statement",
    "05-2026",
    "NAME Pat Example",
    "ACCOUNT NUMBER 333344445555",
    "RHS ACCOUNT NUMBER 111112222",
    "ADDRESS 123 Example St",
    "PERIOD START 2026-05-01",
    "PERIOD END 2026-05-31",
    "OPENING BALANCE $0",
    "CLOSING BALANCE $1,250.50",
    "ACCOUNT ACTIVITY",
    "DATE TRANSACTION TYPE DEBIT CREDIT PRICE VALUE FEE",
    "2026-05-03 Crypto Purchase -- 0.5 ABC $2,000.00 $1,000.00 --",
    "2026-05-09 Crypto Sale 0.1 ABC -- $2,100.00 $210.00 --",
    "2026-05-20 Crypto Withdrawal 0.05 ABC -- $2,200.00 $110.00 --",
    "PORTFOLIO ALLOCATION",
    "ABC (100%)",
    "CRYPTOCURRENCY HELD IN ACCOUNT QUANTITY SYMBOL MARKET VALUE ON 2026/05/31 % OF PORTFOLIO",
    "Abccoin 0.35 ABC $1,250.50 100%",
    "Xyzcoin 0.00001 XYZ $<0.01* <0.01*%",
    "This statement is provided for informational purposes only. See the Robinhood Crypto Customer",
    "Agreement which can be found here .",
  ];
  const { parser, results } = detectAndParse(LINES, LINES.join("\n"));
  const r = results[0];

  test("is recognised ahead of the brokerage and spending parsers", () => {
    assert.equal(parser, robinhoodCryptoParser);
    assert.equal(robinhoodParser.detect(LINES.join("\n")), false);
    assert.equal(robinhoodBrokerageParser.detect(LINES.join("\n")), false);
  });

  test("records the account's value, not the brokerage account's number", () => {
    assert.equal(r.meta.accountNumber, "5555");
    assert.equal(r.meta.accountType, "Investment");
    assert.equal(r.meta.openingBalance, 0);
    assert.equal(r.meta.closingBalance, 1250.5);
    assert.equal(r.meta.periodStart, "2026-05-01");
    assert.equal(r.meta.periodEnd, "2026-05-31");
  });

  test("an older statement that prints only the brokerage number leaves the account blank", () => {
    const old = LINES.filter((l) => !l.startsWith("RHS ")).map((l) =>
      l.startsWith("ACCOUNT NUMBER") ? "ACCOUNT NUMBER 111112222" : l,
    );
    const o = detectAndParse(old, old.join("\n")).results[0];
    assert.equal(o.meta.accountNumber, "");
    assert.match(o.notes.join("\n"), /choose the crypto account/);
  });

  test("returns the activity as trades and imports no transactions", () => {
    assert.equal(r.txns.length, 0);
    assert.equal(r.reconciled, null);
    assert.deepEqual(r.notes, []);
    assert.deepEqual(r.trades, [
      {
        dateIso: "2026-05-03",
        kind: "buy",
        action: "Purchase",
        assetClass: "crypto",
        symbol: "ABC",
        name: "ABC",
        quantity: 0.5,
        price: 2000,
        amount: 1000,
        direction: "Debit",
      },
      {
        dateIso: "2026-05-09",
        kind: "sell",
        action: "Sale",
        assetClass: "crypto",
        symbol: "ABC",
        name: "ABC",
        quantity: -0.1,
        price: 2100,
        amount: 210,
        direction: "Credit",
      },
      {
        dateIso: "2026-05-20",
        kind: "other",
        action: "Withdrawal",
        assetClass: "crypto",
        symbol: "ABC",
        name: "ABC",
        quantity: -0.05,
        price: 2200,
        amount: null, // coins moved, no cash did
        direction: null,
      },
    ]);
  });

  test("reads the coins held at the close", () => {
    assert.deepEqual(r.positions, [
      { assetClass: "crypto", symbol: "ABC", name: "Abccoin", quantity: 0.35, price: null, marketValue: 1250.5 },
      { assetClass: "crypto", symbol: "XYZ", name: "Xyzcoin", quantity: 0.00001, price: null, marketValue: 0 },
    ]);
  });

  test("flags an activity row it cannot read instead of dropping it", () => {
    const odd = [...LINES, "2026-05-21 Crypto Staking reward pending"];
    const o = detectAndParse(odd, odd.join("\n")).results[0];
    assert.match(o.notes.join("\n"), /Unparsed line: 2026-05-21 Crypto Staking/);
  });
});

describe("investment rows", () => {
  const trade = {
    dateIso: "2026-05-10",
    kind: "buy" as const,
    action: "Buy",
    assetClass: "equity" as const,
    symbol: "ACME",
    name: "Acme Corp",
    quantity: 10,
    price: 20,
    amount: 200,
    direction: "Debit" as const,
  };

  test("identical fills on one day each get a row; a re-import hashes the same", () => {
    const a = tradeHashes([trade, trade], "2222");
    assert.notEqual(a[0], a[1]);
    assert.deepEqual(tradeHashes([trade, trade], "2222"), a);
  });

  test("the same trade on another account is a different trade", () => {
    assert.notEqual(tradeHashes([trade], "2222")[0], tradeHashes([trade], "5555")[0]);
  });

  test("rows carry fixed-point strings and drop undated trades", () => {
    const rows = tradeRows([trade, { ...trade, dateIso: null }], "2222", 7);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].accountId, 7);
    assert.equal(rows[0].quantity, "10.00000000");
    assert.equal(rows[0].amount, "200.00");
    const pos = positionRows(
      [{ assetClass: "crypto", symbol: "ABC", name: "Abccoin", quantity: 0.35, price: null, marketValue: 1250.5 }],
      "2026-05-31",
      7,
    );
    assert.deepEqual(pos, [
      {
        accountId: 7,
        asOf: "2026-05-31",
        assetClass: "crypto",
        symbol: "ABC",
        name: "Abccoin",
        quantity: "0.35000000",
        price: null,
        marketValue: "1250.50",
      },
    ]);
  });
});

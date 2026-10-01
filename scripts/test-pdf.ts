/**
 * Parser smoke test (no DB). Run: npx tsx scripts/test-pdf.ts
 * Verifies the Robinhood parser against synthetic statement text in the real layout, and (optionally)
 * runs the full unpdf extraction pipeline on a generated sample PDF if a path is given.
 */
import { robinhoodParser } from "@/server/lib/pdf/parsers/robinhood";
import { detectAndParse } from "@/server/lib/pdf/registry";
import { extractPdf } from "@/server/lib/pdf/extract";
import { readFileSync } from "fs";

const HEADER = [
  "Robinhood Spending Statement 05-2026",
  "NAME Test Account",
  "ACCOUNT NUMBER 000000001234",
  "ADDRESS 123 Example St",
  "OPENING BALANCE $693.94",
  "CLOSING BALANCE $100.00",
  "PERIOD START 05-01-2026",
  "PERIOD END 05-31-2026",
  "FEES THIS STATEMENT $1.75",
  "FEES YEAR-TO-DATE $12.25",
  "DESCRIPTION TRANSACTION DATE CREDIT DEBIT",
];

const TXNS = [
  "DOLLAR DEPOT ANYTOWN, CA CARD 05-01-2026 -- $45.60",
  "CORNER STORE 12 SPRINGFIELD, IL CARD 05-01-2026 -- $31.94",
  "GROCERY MART SPRINGFIELD, IL CARD 05-01-2026 -- $39.78",
  "GROCERY MART SPRINGFIELD, IL CARD 05-01-2026 -- $18.82",
  "COFFEE SHOP ANYTOWN, CA CARD 05-04-2026 -- $43.85",
  "BURGER BARN ANYTOWN, CA CARD 05-04-2026 -- $3.72",
  "CORNER STORE 12 SPRINGFIELD, IL CARD 05-04-2026 -- $21.24",
  "BURGER BARN ANYTOWN, CA CARD 05-04-2026 -- $6.17",
  "CORNER STORE 12 SPRINGFIELD, IL CARD 05-04-2026 -- $4.72",
  "FUEL STOP 7 RIVERSIDE, OR CARD 05-04-2026 -- $7.69",
  "BURGER BARN ANYTOWN, CA CARD 05-05-2026 -- $31.01",
  "ACME CORP PAYROLL NOA 05-06-2026 $612.40 --",
  "External debit card transfer - account ending in 9999 DCF 05-06-2026 -- $75.00",
  "External debit card transfer - withdrawal fee DCF 05-06-2026 -- $1.75",
  "FUEL STOP 7 RIVERSIDE, OR CARD 05-06-2026 -- $45.59",
  "FUEL STOP 7 RIVERSIDE, OR CARD 05-06-2026 -- $28.93",
  "COFFEE SHOP ANYTOWN, CA CARD 05-07-2026 -- $46.91",
  "COFFEE SHOP ANYTOWN, CA CARD 05-08-2026 -- $27.61",
  "GAS N GO SPRINGFIELD, IL CARD 05-08-2026 -- $15.32",
  "GAS N GO SPRINGFIELD, IL CARD 05-08-2026 -- $26.87",
  "Transaction cash back CARD 05-11-2026 $0.93 --",
  "Transaction cash back CARD 05-11-2026 $0.53 --",
  "FUEL STOP 7 RIVERSIDE, OR CARD 05-11-2026 -- $16.19",
  "THRIFT SHOP ANYTOWN, CA CARD 05-11-2026 -- $33.37",
  "GROCERY MART SPRINGFIELD, IL CARD 05-11-2026 -- $28.75",
  "PIZZA PALACE ANYTOWN, CA CARD 05-11-2026 -- $10.64",
  "GROCERY MART SPRINGFIELD, IL CARD 05-11-2026 -- $27.20",
  "GROCERY MART SPRINGFIELD, IL CARD 05-11-2026 -- $27.96",
  "FUEL STOP 7 RIVERSIDE, OR CARD 05-11-2026 -- $11.47",
  "PIZZA PALACE ANYTOWN, CA CARD 05-11-2026 -- $26.46",
  "External debit card transfer - account ending in 9999 DCF 05-12-2026 $45.00 --",
  "SPORTS GRILL 100 RIVERSIDE, OR CARD 05-12-2026 -- $16.45",
  "FUEL STOP 7 RIVERSIDE, OR CARD 05-12-2026 -- $44.48",
  "DOLLAR DEPOT ANYTOWN, CA CARD 05-12-2026 -- $15.79",
  "SPORTS GRILL 100 RIVERSIDE, OR CARD 05-12-2026 -- $10.27",
  "Marketplace Payout Inc. ANYTOWN,CA CARD 05-13-2026 $210.00 --",
  "Transaction cash back CARD 05-14-2026 $0.75 --",
  "SPORTS GRILL 100 RIVERSIDE, OR CARD 05-14-2026 -- $13.23",
  "FUEL STOP 7 RIVERSIDE, OR CARD 05-15-2026 -- $15.81",
  "TACO PLACE ANYTOWN, CA CARD 05-18-2026 -- $42.26",
  "HARDWARE HUB SPRINGFIELD, IL CARD 05-18-2026 -- $22.65",
  "FUEL STOP 7 RIVERSIDE, OR CARD 05-18-2026 -- $47.09",
  "GROCERY MART SPRINGFIELD, IL CARD 05-18-2026 -- $25.55",
  "GAS N GO SPRINGFIELD, IL CARD 05-18-2026 -- $36.83",
  "GAS N GO SPRINGFIELD, IL CARD 05-18-2026 -- $44.93",
  "CORNER STORE 12 SPRINGFIELD, IL CARD 05-18-2026 -- $3.80",
  "PIZZA PALACE ANYTOWN, CA CARD 05-18-2026 -- $5.57",
  "BOOK NOOK RIVERSIDE, OR CARD 05-18-2026 -- $28.36",
  "CAR WASH EXPRESS SPRINGFIELD, IL CARD 05-18-2026 -- $39.64",
  "DOLLAR DEPOT ANYTOWN, CA CARD 05-18-2026 -- $33.98",
  "FUEL STOP 7 RIVERSIDE, OR CARD 05-19-2026 -- $24.85",
  "SPORTS GRILL 100 RIVERSIDE, OR CARD 05-19-2026 -- $22.99",
  "THRIFT SHOP ANYTOWN, CA CARD 05-19-2026 -- $6.31",
  "Marketplace Payout Inc. ANYTOWN,CA CARD 05-20-2026 $180.25 --",
  "ACME CORP PAYROLL NOA 05-20-2026 $1,850.40 --",
  "PHARMACY PLUS SPRINGFIELD, IL CARD 05-21-2026 -- $23.81",
  "PIZZA PALACE ANYTOWN, CA CARD 05-22-2026 -- $4.99",
  "Transfer from Spending to Brokerage XENT 05-26-2026 -- $2,300.00",
  "Marketplace Payout Inc. ANYTOWN,CA CARD 05-27-2026 $390.00 --",
  "Transfer from Spending to Brokerage XENT 05-27-2026 -- $350.00",
];

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}`, detail ?? "");
  }
}

const lines = [...HEADER, ...TXNS];
const text = lines.join("\n");

console.log("Robinhood parser — synthetic statement text:");
check("detect() true", robinhoodParser.detect(text));
const r = robinhoodParser.parse(lines, text);

check(`account last4 = 1234 (got ${r.meta.accountNumber})`, r.meta.accountNumber === "1234");
check(`opening = 693.94 (got ${r.meta.openingBalance})`, r.meta.openingBalance === 693.94);
check(`closing = 100 (got ${r.meta.closingBalance})`, r.meta.closingBalance === 100);
check(`periodStart = 2026-05-01 (got ${r.meta.periodStart})`, r.meta.periodStart === "2026-05-01");
check(`periodEnd = 2026-05-31 (got ${r.meta.periodEnd})`, r.meta.periodEnd === "2026-05-31");
check(`txn count = 60 (got ${r.txns.length})`, r.txns.length === 60);

const credits = r.txns.filter((t) => t.direction === "Credit");
const debits = r.txns.filter((t) => t.direction === "Debit");
check(`9 credits (got ${credits.length})`, credits.length === 9);
check(`51 debits (got ${debits.length})`, debits.length === 51);

const sumCredit = credits.reduce((a, t) => a + (t.amount ?? 0), 0);
const sumDebit = debits.reduce((a, t) => a + (t.amount ?? 0), 0);
check(`credit total ≈ 3290.26 (got ${sumCredit.toFixed(2)})`, Math.abs(sumCredit - 3290.26) < 0.005);
console.log(`    debit total = ${sumDebit.toFixed(2)}`);

// The strongest correctness check: every txn captured with the right sign means the
// net flow equals the statement's opening→closing change.
const net = sumCredit - sumDebit;
const delta = (r.meta.closingBalance ?? 0) - (r.meta.openingBalance ?? 0);
check(
  `reconciles: credits−debits (${net.toFixed(2)}) == closing−opening (${delta.toFixed(2)})`,
  Math.abs(net - delta) < 0.005,
);

const comma = r.txns.find((t) => t.amount === 1850.4);
check("comma amount $1,850.40 parsed", !!comma && comma.direction === "Credit");
const hyphenDesc = r.txns.find((t) => t.description === "External debit card transfer - account ending in 9999" && t.amount === 75);
check("hyphenated description preserved", !!hyphenDesc && hyphenDesc.direction === "Debit");
const bigTransfer = r.txns.find((t) => t.amount === 2300 && t.description === "Transfer from Spending to Brokerage");
check("XENT transfer parsed as Debit $2300", !!bigTransfer && bigTransfer.direction === "Debit");
check(`fees not imported as txns (no FEES rows)`, !r.txns.some((t) => /FEES/.test(t.description)));
check(`unparsed-line notes = 0 (got ${r.notes.length})`, r.notes.length === 0, r.notes);

// End-to-end through the registry + real PDF extraction (optional).
async function main() {
  const pdfPath = process.argv[2];
  if (pdfPath) {
    console.log(`\nEnd-to-end extraction of ${pdfPath}:`);
    const bytes = new Uint8Array(readFileSync(pdfPath));
    const ex = await extractPdf(bytes);
    console.log(`  pages=${ex.pageCount} lines=${ex.lines.length}`);
    const d = detectAndParse(ex.lines, ex.text);
    check("registry detected a parser", !!d.parser, d.parser?.id);
    console.log("  parsed txns:", d.result?.txns.length, "meta:", d.result?.meta);
  }

  console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main();

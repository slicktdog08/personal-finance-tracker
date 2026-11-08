// "New since you last looked" for transactions. Client-safe constants shared by the server
// query/action and the client marker.
//
// The watermark is the highest transaction id the user has seen, stored as a ui_layouts row
// (that table is the app's small key → JSON store for UI state, so no migration is needed).
// Transaction ids only grow, and a pending row that posts is merged into its existing row, so
// "id > watermark" is exactly "arrived since your last visit" — imports, PDF imports and bank sync.

/** ui_layouts.layout_key holding `{ lastSeenId: number }`. */
export const TXN_SEEN_KEY = "transactions-seen";

/** Window event fired once the Transactions page has marked rows seen, so the nav badge clears without a reload. */
export const TXN_SEEN_EVENT = "mp:transactions-seen";

/** Rows the user typed in themselves are never "new" to them. */
export const TXN_SEEN_IGNORED_SOURCE = "manual";

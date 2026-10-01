// Shared types for categorization actions (kept out of the "use server" file,
// which may only export async functions).

export interface MatchParams {
  field: "description" | "category";
  matchType: "contains" | "equals" | "regex";
  pattern: string;
  onlyUncategorized: boolean;
}

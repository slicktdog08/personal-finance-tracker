// Test-only replacement for @/server/auth/session: every caller is "signed in".
module.exports = {
  requireSession: async () => ({ userId: "e2e", username: "e2e", email: "e2e@example.com" }),
  getSession: async () => ({ userId: "e2e", username: "e2e", email: "e2e@example.com" }),
};

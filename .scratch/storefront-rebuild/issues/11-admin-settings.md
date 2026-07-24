# 11 — Admin Settings screen

**What to build:** The store owner adjusts store-wide commerce settings themselves — no developer, no Stripe Dashboard trip, no redeploy (ADR-0004). Changing the shipping rate, free-shipping threshold, tax toggle, or contact email edits the `settings` row that checkout already reads live, so the next checkout reflects the change immediately.

**Blocked by:** 08.

**Status:** ready-for-agent

- [ ] Settings screen edits the `settings` table: flat shipping rate, free-shipping threshold, tax-enabled toggle, and contact email
- [ ] Changes take effect on the next checkout without a redeploy (checkout reads `settings` live, per 05)
- [ ] The tax toggle defaults off and can be turned on the moment the client confirms nexus registration
- [ ] The screen resists scope growth — only these four values
- [ ] The write goes through a mutation that reuses the authorization helper from 08

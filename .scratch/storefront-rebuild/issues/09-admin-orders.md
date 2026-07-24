# 09 — Admin Orders screen

**What to build:** The store owner's daily triage view. They land in `/admin` on their orders, newest first, can filter to what needs action, open an order to see everything needed to fulfill it, and record fulfillment — marked shipped with a tracking number, plus internal notes for themselves.

**Blocked by:** 08, 06.

**Status:** ready-for-agent

- [ ] Orders list is the default `/admin` landing screen, newest first, filterable by status (paid / shipped / refunded / cancelled)
- [ ] Each row shows date, email, total, an item summary, and a status badge
- [ ] Order detail shows the full line-item snapshot, shipping address, and a link out to the matching Stripe payment
- [ ] Mark-shipped action, with an optional tracking number, updates status and records `shippedAt`
- [ ] An internal note can be added to an order
- [ ] All writes go through mutations that reuse the authorization helper from 08

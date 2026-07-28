# 07 — Reservation sweeper cron

**What to build:** The safety net for abandoned checkouts. A shopper who starts a checkout and walks away shouldn't lock up inventory forever — a scheduled sweep releases stale held reservations so the stock becomes available to others within a few minutes, even for sessions that never fire an `expired` event.

**Blocked by:** 05 (independent of 06).

**Status:** ready-for-verification

- [x] A Convex cron runs every 5 minutes
- [x] It finds reservations where `status === "held"` and `expiresAt < now`, sets them `released`, and decrements `reserved`
- [x] `committed` and already-`released` reservations are never touched
- [x] Seam 1 tests confirm only held-and-expired rows are released and that committed/released rows are left untouched
- [ ] Done when: a deliberately abandoned session's reservation is released within a few minutes and the stock is available again

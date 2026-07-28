import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Five minutes is the promise the spec makes a shopper waiting on someone
// else's abandoned cart: stock comes back "within a few minutes". It is also
// far short of the 30-minute reservation TTL, so a live checkout is never at
// risk of being swept out from under itself.
crons.interval(
  "release expired reservations",
  { minutes: 5 },
  internal.checkout.sweepExpiredReservations,
  {},
);

export default crons;

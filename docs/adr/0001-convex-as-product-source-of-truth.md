# Convex is the Product source of truth, mirrored out to Stripe

We considered flipping this: managing Products directly in the Stripe Dashboard (name, description, price, images) and having the storefront read the catalog straight from the Stripe API, with Convex reduced to inventory/orders only. That would delete the entire sync engine (masterplan §6) and shrink `/admin` to Orders + Settings.

We rejected it and kept Convex as the source of truth, synced to Stripe via an internal action (masterplan §6). Reasoning: the Admin edits Products in one place (`/admin`) regardless of which system is "true," and Convex-as-source-of-truth keeps the storefront's catalog reads independent of Stripe API availability/latency. The cost — the sync engine's complexity (Price immutability, `syncStatus` tracking) — was accepted deliberately rather than overlooked.

**Status**: accepted

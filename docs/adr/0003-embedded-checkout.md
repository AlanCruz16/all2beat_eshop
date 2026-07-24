# Stripe Checkout runs in embedded mode, not hosted redirect

Masterplan §1/§3 left this open ("hosted or embedded"). We chose **embedded** (`ui_mode: 'embedded_page'` — Stripe's post-2026-03-25 name for what was `'embedded'`) to match the current site's embedded checkout feel, over the simpler hosted-redirect flow.

This is a real trade-off, not the path of least resistance: hosted redirect is what the rest of the architecture optimizes for ("zero custom checkout UI, zero PCI scope," masterplan §1) and needs no client-side Stripe code at all. Embedded requires two new client-side dependencies (`@stripe/stripe-js`, `@stripe/react-stripe-js`), a client component wrapping `<EmbeddedCheckoutProvider>`, and changes the session-creation contract: `return_url` instead of `success_url`/`cancel_url`, and the action returns `session.client_secret` instead of `session.url`. The success page must call `retrieveSession` client-side to check `session.status` rather than trusting the redirect alone.

No cost difference from Stripe either way — same 2.9% + 30¢ per transaction.

**Status**: accepted

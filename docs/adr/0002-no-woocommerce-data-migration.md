# No migration of WooCommerce content or historical data

The old all2beat.com WooCommerce site's product data is not scraped or imported: Product names, descriptions, prices, and photography are sourced first-hand from the client, since the live site is mostly placeholder content anyway. Historical Orders and customer records are archived/exported before teardown for the client's own records only — never imported into the new system's `orders` table.

This means the new store launches with zero historical Order data by design, not as a gap to fill in later. The archival export exists purely as a backup, not as a migration input. A future engineer should not expect (or build toward) any import path from the old WooCommerce database.

**Status**: accepted

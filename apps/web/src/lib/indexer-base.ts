/**
 * Browser-facing indexer base — always same-origin via the /api/indexer proxy
 * (src/app/api/indexer/[...path]/route.ts).
 *
 * Relative path means the browser hits the frontend's own origin, which forwards
 * to the indexer over Railway's private network. No build-time URL, no CORS, no
 * public indexer domain. Works identically in dev (Next dev server runs the
 * proxy → localhost:4350) and prod.
 */
export const INDEXER_BASE = "/api/indexer";

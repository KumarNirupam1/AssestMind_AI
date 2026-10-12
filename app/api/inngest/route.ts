/**
 * app/api/inngest/route.ts — Inngest App Router handler.
 *
 * Inngest requires GET + POST + PUT to be served from one endpoint.
 * This file registers all background functions with the Inngest platform.
 *
 * Local dev: run `npx inngest-cli@latest dev` to start the Inngest dev server,
 * which calls this handler on each triggered event.
 *
 * Production: set INNGEST_EVENT_KEY and INNGEST_SIGNING_KEY in Vercel env vars.
 * Inngest validates the signing key on each incoming request.
 */
import { serve } from "inngest/next";

import { inngest } from "@/lib/inngest";
import { ingestDocument } from "@/features/ingestion/inngest-functions";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [ingestDocument],
});

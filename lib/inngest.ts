/**
 * lib/inngest.ts — Inngest client singleton.
 *
 * Import `inngest` from here in every function file and in the route handler.
 * One client, one event namespace.
 */
import { Inngest } from "inngest";

export const inngest = new Inngest({ id: "assetmind-ai" });

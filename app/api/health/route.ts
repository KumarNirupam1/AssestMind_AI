import { prisma } from "@/lib/db";

/**
 * Public liveness/readiness probe for uptime checks and deploy verification.
 * It runs the cheapest possible database round-trip and never leaks internals:
 * a failure is reported as `degraded`, not as an exception body.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VERSION = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json(
      { status: "ok", database: "up", version: VERSION },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { status: "degraded", database: "down", version: VERSION },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

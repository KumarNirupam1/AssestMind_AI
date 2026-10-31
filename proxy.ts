import { clerkMiddleware } from "@clerk/nextjs/server";

/**
 * Clerk session middleware.
 *
 * Authorization is enforced where data is read — `app/(root)/layout.tsx` and
 * `app/api/chat/route.ts` both call `auth.protect()` — rather than with a
 * route matcher here. That keeps a new page from silently inheriting (or
 * losing) protection based on a regex, and avoids Clerk's deprecated
 * `createRouteMatcher`. Public auth screens and the signature-verified
 * Inngest webhook stay reachable by design.
 */
export default clerkMiddleware();

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
    // Always run for Clerk-specific frontend API routes
    "/__clerk/(.*)",
  ],
};

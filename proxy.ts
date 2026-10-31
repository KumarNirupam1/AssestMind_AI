import { clerkMiddleware } from "@clerk/nextjs/server";

<<<<<<< HEAD
const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/inngest(.*)",
]);

/** Clerk middleware. Protects every route except the auth screens. */
export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});
=======
/**
 * Clerk session middleware.
 *
 * Authorization is enforced where data is read — `app/(root)/layout.tsx` and
 * `app/api/chat/route.ts` both call `auth.protect()` — rather than with a
 * route matcher here. That keeps a new page from silently inheriting (or
 * losing) protection based on a regex, and avoids Clerk's deprecated
 * `createRouteMatcher`. Public auth screens stay reachable by design.
 */
export default clerkMiddleware();
>>>>>>> 022f4d6 ( harden code)

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

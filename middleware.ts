import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/*
  Phase 6I.6.31 - these 8 routes previously had no server-side protection at
  all (middleware only refreshed the session cookie), and most of them also
  had no client-side guard (audited: career-memory, find-jobs, paste-job,
  create-package, job-tracker had zero guard; analytics never redirected;
  settings flashed content before redirecting). Redirecting unauthenticated
  requests here closes that gap for all 8 uniformly, without moving any
  files into a route group.
*/
const PROTECTED_PATHS = [
  "/dashboard",
  "/career-memory",
  "/find-jobs",
  "/paste-job",
  "/create-package",
  "/job-tracker",
  "/analytics",
  "/settings",
  // Phase 6I.6.37 - authentication-only gate. This is NOT the admin
  // authorization check (a logged-in non-staff user still reaches
  // /admin's server code past this point) - the real role/permission
  // enforcement lives in lib/admin/auth.ts's requireAdminPermission(),
  // called by every admin page and API route individually. See that
  // module's own header comment for why role-awareness doesn't belong
  // in Edge middleware here (a DB round-trip per request, and the
  // per-tab permission differs per route - one boolean here can't
  // express that).
  "/admin",
];

function isProtectedPath(pathname: string) {
  return PROTECTED_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  );
}

/*
  Admin User Controls Phase 2 - narrowest central enforcement point for
  account suspension (see profiles.suspended_at, set via
  lib/admin/queries/userControls.ts's suspendUser()). Deliberately here,
  not scattered across every API route: this middleware's own matcher
  (see `config` below) already runs on essentially every request -
  static assets aside - so a single check here covers both page
  navigation AND API calls uniformly, closing the "hidden UI is not
  security" gap a page-only check would leave (a suspended user could
  otherwise keep calling e.g. /api/generate-package directly even with
  every page blocked).

  /api/delete-account is deliberately exempt: a suspended user must
  still be able to leave the Service by deleting their own account -
  suspension is not intended to trap someone into an account they can
  neither use nor close.

  This check only ever runs for an ALREADY-authenticated user (the
  `user` lookup below is shared with the pre-existing unauthenticated
  redirect logic) - an unauthenticated request is unaffected, and this
  adds exactly one extra lightweight indexed-PK lookup (profiles.id) to
  every authenticated request, never a write.
*/
const SUSPENSION_EXEMPT_API_PATHS = ["/api/delete-account"];

function isApiPath(pathname: string) {
  return pathname.startsWith("/api/");
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name) {
          return request.cookies.get(name)?.value;
        },
        set(name, value, options) {
          response.cookies.set({
            name,
            value,
            ...options,
          });
        },
        remove(name, options) {
          response.cookies.set({
            name,
            value: "",
            ...options,
            maxAge: 0,
          });
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  if (!user && isProtectedPath(pathname)) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (user) {
    const suspensionRelevant =
      isProtectedPath(pathname) ||
      (isApiPath(pathname) && !SUSPENSION_EXEMPT_API_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`)));

    if (suspensionRelevant) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("suspended_at")
        .eq("id", user.id)
        .maybeSingle();

      if (profile?.suspended_at) {
        if (isApiPath(pathname)) {
          return NextResponse.json(
            { error: "This account has been suspended.", code: "ACCOUNT_SUSPENDED" },
            { status: 403 }
          );
        }
        return NextResponse.redirect(new URL("/?accountSuspended=1", request.url));
      }
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

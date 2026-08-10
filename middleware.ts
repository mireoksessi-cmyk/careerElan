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

  if (!user && isProtectedPath(request.nextUrl.pathname)) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
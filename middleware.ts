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
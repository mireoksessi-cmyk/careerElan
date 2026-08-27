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

/*
  Netlify gives this site more hostnames than the one users are meant to
  browse: every deploy gets a permanent <deploy-id>--<site>.netlify.app
  permalink, and the production branch gets master--<site>.netlify.app.
  All of them serve the app, but a deploy permalink is FROZEN to that
  build forever.

  That matters for auth specifically. Supabase's auth cookies carry no
  Domain attribute (lib/supabase.ts / lib/supabase-server.ts / the client
  below all use @supabase/ssr defaults), so they are host-only, and
  lib/auth/auth.ts starts OAuth with
  redirectTo: `${window.location.origin}/auth/callback`, so the provider
  returns to whichever host the click happened on. Browsing an alternate
  host therefore creates a SEPARATE session that the canonical host
  cannot see - Production logs on 2026-08-17 show seven consecutive
  Google logins landing on 6a832a98...--<site> and master--<site> rather
  than the canonical host, which reads to a user as "login failed" and,
  on an older permalink, as "the site went back to an old version".

  Redirecting here, before the session client is built, moves the browser
  onto the canonical host BEFORE any OAuth click, so window.location.origin
  is already canonical when the flow starts.

  Deliberate details:
  - The destination is built from the CANONICAL_HOST constant, never from
    the incoming Host header. The header is only ever read as a boolean
    test, so a forged Host cannot steer the redirect.
  - The suffix test requires the hostname to END with
    "--<canonical host>", which only Netlify can issue for this site.
    localhost, 127.0.0.1, any other *.netlify.app site, and any custom
    domain never match. The canonical host itself has no "--" and cannot
    match, so this cannot loop.
  - pathname and search are preserved verbatim, including an OAuth
    ?code=... A code minted for an alternate host will still fail its PKCE
    exchange on the canonical host (the verifier cookie is host-only) -
    that in-flight case was already broken; what this prevents is the flow
    ever STARTING on the wrong host.
  - 307, not 308: a permanent redirect would be cached by browsers and
    would make deploy permalinks unopenable for debugging long after this
    code changed.
*/
const CANONICAL_HOST = "fabulous-frangipane-b5d970.netlify.app";
const NETLIFY_ALTERNATE_HOST_SUFFIX = `--${CANONICAL_HOST}`;

/*
  Where users belong. CANONICAL_HOST above names the Netlify site, which is
  what the suffix test is built from and still has to be; this is the address
  the product actually has, and the only destination this middleware sends
  anyone to.

  The two were the same value until now, which is why the site's own default
  Netlify hostname stayed user-facing: it served production, nothing sent a
  visitor away from it, and it has no "--" so the alternate-host test below
  never saw it. Someone who landed there - from a search result, an old link,
  an OAuth redirect before app/auth/callback/route.ts was fixed - simply
  stayed on an address that names a hosting provider rather than this product.

  A fixed constant, never interpolated from a request, so no Host header can
  steer where anyone is sent.
*/
const PUBLIC_CANONICAL_ORIGIN = "https://careerelan.com";

function isNetlifyAlternateHost(hostHeader: string | null) {
  if (!hostHeader) return false;
  const hostname = hostHeader.split(":")[0].toLowerCase();

  /*
    The site's own default hostname. Matched exactly, not by suffix: it
    carries no "--" and would otherwise fall through the test below, which is
    precisely how it stayed visible. careerelan.com itself matches nothing
    here and is never redirected, so there is no loop.
  */
  if (hostname === CANONICAL_HOST) return true;
  /*
    One exemption: this site's own Deploy Previews. A pull request's
    preview is the only pre-production surface this project has - the
    production Netlify host and careerelan.com are the same deployment -
    so canonicalizing a preview away sends every reviewer to production
    and there is nowhere left to review a change before release. Unlike a
    deploy permalink, a Deploy Preview is a host reviewers are MEANT to
    browse, and its session being separate from production's is the point
    rather than the bug the rule above exists to fix.

    Deliberately narrow. The label before the suffix must be exactly
    Netlify's own deploy-preview-<number> form, so master-- and
    <deploy-id>-- permalinks still canonicalize as before. The suffix is
    still required, so this can only ever exempt a preview Netlify issued
    for THIS site; a lookalike on any other domain fails that test and is
    handled exactly as it was before. The redirect this skips is built
    from the CANONICAL_HOST constant either way, so no attacker-supplied
    host can be reached through this branch.
  */
  if (
    hostname.endsWith(NETLIFY_ALTERNATE_HOST_SUFFIX) &&
    /^deploy-preview-\d+$/.test(
      hostname.slice(0, -NETLIFY_ALTERNATE_HOST_SUFFIX.length)
    )
  ) {
    return false;
  }
  return (
    hostname.length > NETLIFY_ALTERNATE_HOST_SUFFIX.length &&
    hostname.endsWith(NETLIFY_ALTERNATE_HOST_SUFFIX)
  );
}

export async function middleware(request: NextRequest) {
  if (isNetlifyAlternateHost(request.headers.get("host"))) {
    return NextResponse.redirect(
      new URL(
        `${request.nextUrl.pathname}${request.nextUrl.search}`,
        /*
          Deploy permalinks used to be sent to the Netlify hostname, which is
          now itself a host this middleware redirects away from - leaving them
          pointed there would only add a second hop through the address the
          change exists to retire.
        */
        PUBLIC_CANONICAL_ORIGIN
      ),
      307
    );
  }

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
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/internal/canonical-career-memory/resume-preview).*)"],
};

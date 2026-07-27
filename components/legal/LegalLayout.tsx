import Link from "next/link";

/*
  Shared shell for the three public legal pages (/privacy, /terms,
  /cookies) - kept as a plain server component (no "use client") since
  none of this needs interactivity, matching the "no client component
  unless genuinely necessary" requirement. Centralizes branding, the
  back-to-home link, cross-links between the three legal pages, and the
  "Last Updated" display so each page.tsx only needs to supply its own
  title and body content.
*/
export default function LegalLayout({
  title,
  lastUpdated,
  children,
}: {
  title: string;
  lastUpdated: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-slate-200">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-5">
          <Link
            href="/"
            className="text-lg font-black text-slate-950"
          >
            Career Élan
          </Link>

          <Link
            href="/"
            className="text-sm font-semibold text-slate-500 transition hover:text-blue-600"
          >
            ← Back to home
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-black text-slate-950 sm:text-4xl">
          {title}
        </h1>

        <p className="mt-3 text-sm font-semibold text-slate-500">
          Last Updated: {lastUpdated}
        </p>

        <article className="legal-content mt-10 text-[15px] leading-7 text-slate-700">
          {children}
        </article>
      </main>

      <footer className="border-t border-slate-200">
        <div className="mx-auto flex max-w-3xl flex-col items-start gap-3 px-6 py-8 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 Career Élan. All rights reserved.</p>

          <nav className="flex gap-5">
            <Link href="/privacy" className="hover:text-blue-600">
              Privacy Policy
            </Link>
            <Link href="/terms" className="hover:text-blue-600">
              Terms of Service
            </Link>
            <Link href="/cookies" className="hover:text-blue-600">
              Cookie Policy
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

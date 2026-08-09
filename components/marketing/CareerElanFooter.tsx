import Image from "next/image";
import FooterGroup, {
  PRODUCT_FOOTER_ITEMS,
  PRODUCT_FOOTER_LINKS,
  COMPANY_FOOTER_ITEMS,
  COMPANY_FOOTER_LINKS,
} from "@/components/marketing/FooterGroup";

/*
  Phase 6I.6.30 - the single Career Élan Footer, extracted verbatim from
  the identical markup that was previously repeated in app/page.tsx and
  every marketing/legal page (Features/How It Works/Pricing/About/
  Contact/LegalLayout) - same brand block, same Product/Company/Legal
  FooterGroup columns, same copyright line. Now also reused inside the
  authenticated app shell (Dashboard, Career Memory, Find Jobs, Paste
  Job, Job Tracker, Analytics, Settings) so public and authenticated
  footers can never drift apart - there is exactly one Footer source of
  truth (this component + FooterGroup's own PRODUCT_/COMPANY_ constants).

  Renders in normal document flow only (no position:fixed/absolute) -
  callers are responsible for placing it after their page's main content,
  not inside a Sidebar or a fixed-height scroll container.
*/
export default function CareerElanFooter() {
  return (
    <footer className="bg-slate-950 px-6 py-10 text-white sm:px-10 lg:px-16 xl:px-20">
      <div className="mx-auto grid max-w-7xl gap-8 md:grid-cols-4">
        <div>
          <Image
            src="/logo.png"
            alt="Career Élan"
            width={190}
            height={74}
            className="h-auto w-[170px] rounded-md bg-white/95 p-1"
          />
          <p className="mt-4 text-sm text-slate-400">
            AI-powered career operating system.
          </p>
          <div className="mt-5 flex gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-xs font-black">
              in
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-xs font-black">
              𝕏
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-xs font-black">
              ◎
            </span>
          </div>
        </div>
        <FooterGroup
          title="Product"
          items={PRODUCT_FOOTER_ITEMS}
          links={PRODUCT_FOOTER_LINKS}
        />
        <FooterGroup
          title="Company"
          items={COMPANY_FOOTER_ITEMS}
          links={COMPANY_FOOTER_LINKS}
        />
        <FooterGroup
          title="Legal"
          items={["Privacy Policy", "Terms of Service", "Cookie Policy"]}
          links={{
            "Privacy Policy": "/privacy",
            "Terms of Service": "/terms",
            "Cookie Policy": "/cookies",
          }}
        />
      </div>
      <p className="mx-auto mt-8 max-w-7xl border-t border-white/10 pt-6 text-center text-sm text-slate-500">
        © 2026 Career Élan. All rights reserved.
      </p>
    </footer>
  );
}

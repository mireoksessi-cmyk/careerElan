import Link from "next/link";

/*
  Shared footer column used by the public landing page (app/page.tsx) and
  other public marketing pages (e.g. app/features/page.tsx) - extracted so
  a link added for one page's footer (e.g. Product -> Features) is defined
  in exactly one place instead of drifting across duplicated footers. Only
  items with a matching href in `links` render as a real link - the rest
  stay plain text, avoiding broken/placeholder hrefs for pages that don't
  exist yet.
*/

/*
  Phase 6I.6.29 - a link target is either a plain internal href string
  (renders via next/link <Link>, unchanged behavior) or an explicit
  { href, external: true } descriptor (renders via a real <a
  target="_blank" rel="noopener noreferrer">). Kept as a small discriminated
  shape rather than a string-prefix hack (e.g. sniffing "https://") so
  internal vs. external is unambiguous and type-checked, without rewriting
  FooterGroup's own rendering model.
*/
export type FooterLinkTarget = string | { href: string; external: true };

/*
  Phase 6I.6.26 - the Product group's own items/links, centralized so
  every public marketing page (/, /features, /how-it-works, /pricing)
  renders the identical list from one source instead of four copies that
  could silently drift. "Examples" is deliberately absent - removed from
  the data itself, not hidden/disabled, per this phase's own requirement.
*/
export const PRODUCT_FOOTER_ITEMS = ["Features", "How It Works", "Pricing"];

export const PRODUCT_FOOTER_LINKS: Record<string, FooterLinkTarget> = {
  Features: "/features",
  "How It Works": "/how-it-works",
  Pricing: "/pricing",
};

/*
  Phase 6I.6.29 - final Company group: About Us (internal), Blog (external
  LinkedIn company page), Contact (internal /contact). Careers stays
  absent - not reintroduced. Blog is external because this phase does not
  build an internal /blog page.
*/
export const COMPANY_FOOTER_ITEMS = ["About Us", "Blog", "Contact"];

export const COMPANY_FOOTER_LINKS: Record<string, FooterLinkTarget> = {
  "About Us": "/about",
  Blog: {
    href: "https://www.linkedin.com/company/career-elan/?viewAsMember=true",
    external: true,
  },
  Contact: "/contact",
};

export default function FooterGroup({
  title,
  items,
  links,
}: {
  title: string;
  items: string[];
  links?: Record<string, FooterLinkTarget>;
}) {
  return (
    <div>
      <p className="font-black">{title}</p>
      <div className="mt-4 space-y-3 text-sm text-slate-400">
        {items.map((item) => {
          const target = links?.[item];

          if (!target) {
            return <p key={item}>{item}</p>;
          }

          if (typeof target === "string") {
            return (
              <Link
                key={item}
                href={target}
                className="block transition hover:text-white"
              >
                {item}
              </Link>
            );
          }

          return (
            <a
              key={item}
              href={target.href}
              target="_blank"
              rel="noopener noreferrer"
              className="block transition hover:text-white"
            >
              {item}
            </a>
          );
        })}
      </div>
    </div>
  );
}

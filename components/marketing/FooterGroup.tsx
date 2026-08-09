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
  Phase 6I.6.26 - the Product group's own items/links, centralized so
  every public marketing page (/, /features, /how-it-works, /pricing)
  renders the identical list from one source instead of four copies that
  could silently drift. "Examples" is deliberately absent - removed from
  the data itself, not hidden/disabled, per this phase's own requirement.
*/
export const PRODUCT_FOOTER_ITEMS = ["Features", "How It Works", "Pricing"];

export const PRODUCT_FOOTER_LINKS: Record<string, string> = {
  Features: "/features",
  "How It Works": "/how-it-works",
  Pricing: "/pricing",
};

/*
  Phase 6I.6.28 - Blog/Careers/Contact removed from the Company group's
  own data (not hidden via CSS/disabled/placeholder href) since none of
  those pages exist. "About Us" is the only real Company destination.
*/
export const COMPANY_FOOTER_ITEMS = ["About Us"];

export const COMPANY_FOOTER_LINKS: Record<string, string> = {
  "About Us": "/about",
};

export default function FooterGroup({
  title,
  items,
  links,
}: {
  title: string;
  items: string[];
  links?: Record<string, string>;
}) {
  return (
    <div>
      <p className="font-black">{title}</p>
      <div className="mt-4 space-y-3 text-sm text-slate-400">
        {items.map((item) =>
          links?.[item] ? (
            <Link
              key={item}
              href={links[item]}
              className="block transition hover:text-white"
            >
              {item}
            </Link>
          ) : (
            <p key={item}>{item}</p>
          )
        )}
      </div>
    </div>
  );
}

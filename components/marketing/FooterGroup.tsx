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

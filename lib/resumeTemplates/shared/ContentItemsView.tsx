/*
  Phase 6F - shared React renderer for NormalizedContentItem[] (the
  one normalized shape both flat content[] and hierarchical
  hierarchicalContent[] entries reduce to via contentAdapters.ts).
  Reused by all 3 new templates' entry renderers instead of each one
  re-implementing "walk a tree of bullet/paragraph/subheading nodes."
  Semantic HTML: bullets become <li> inside <ul>, paragraphs become
  <p>, subheadings become <p class="subheading"> followed by their own
  nested <ContentItemsView> for children - never a bare div-only
  structure (spec section 9's own prohibition).
*/
import React from "react";
import type { NormalizedContentItem } from "./contentAdapters";

export function ContentItemsView({ items, textColor }: { items: NormalizedContentItem[]; textColor: string }): React.ReactElement | null {
  if (items.length === 0) return null;

  const bulletRun: NormalizedContentItem[] = [];
  const flushed: React.ReactNode[] = [];
  let bulletKey = 0;

  const flushBullets = () => {
    if (bulletRun.length === 0) return;
    flushed.push(
      <ul key={`bullets-${bulletKey++}`} style={{ margin: "2px 0 4px 0", paddingLeft: "1.1em" }}>
        {bulletRun.map((b) => (
          <li key={b.id} style={{ color: textColor, marginBottom: "2px" }}>
            {b.text}
          </li>
        ))}
      </ul>
    );
    bulletRun.length = 0;
  };

  for (const item of items) {
    if (item.kind === "bullet") {
      bulletRun.push(item);
      continue;
    }
    flushBullets();
    if (item.kind === "paragraph") {
      flushed.push(
        <p key={item.id} style={{ color: textColor, margin: "2px 0 4px 0" }}>
          {item.text}
        </p>
      );
    } else {
      flushed.push(
        <div key={item.id} style={{ margin: "4px 0" }}>
          <p style={{ color: textColor, fontWeight: 600, margin: "0 0 2px 0" }}>
            {item.numberingLabel ? `${item.numberingLabel} ` : ""}
            {item.text}
          </p>
          <div style={{ paddingLeft: "1em" }}>
            <ContentItemsView items={item.children} textColor={textColor} />
          </div>
        </div>
      );
    }
  }
  flushBullets();

  return <>{flushed}</>;
}

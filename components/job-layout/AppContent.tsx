import type { ReactNode } from "react";

/*
  Phase 1A - the single owner of horizontal gutter, vertical page spacing,
  maximum width and centering for every authenticated page's content.

  Before this, all eight authenticated pages hand-rolled that wrapper and
  disagreed four ways (`min-w-0 flex-1` alone, `... px-8 py-6`, `... p-8`,
  and one `flex-1 p-8` missing its shrink guard). An 88/88 live measurement
  of the production app - 8 routes x 11 viewport widths - established the
  values below, so they are measured rather than chosen:

  - px-5 (20px) below 640. The measured mobile gutter was a flat 32px,
    which leaves only 256px of content on a 320px screen; 20px matches the
    shared Sidebar's own px-5 and the public pages' proven scale.
  - sm:px-8 (32px) from 640 up - identical to what every route already
    measured, so nothing changes at or above that width.
  - No xl step. The measured gutter is a flat 32px at 1024, 1280 and 1440
    on all eight routes, so adding a wider desktop step would introduce an
    inconsistency rather than remove one.
  - max-w-[1280px]. The widest measured content was 1200px at a 1440px
    viewport, so this cap is inert at every tested width and only engages
    on displays wider than roughly 1520px.
  - min-w-0, because a flex child defaults to min-width:auto and therefore
    refuses to shrink below its min-content width. Seven routes already set
    it on their own shell; /settings did not.

  Deliberately prop-less. Every one of the eight routes fit these values
  with no exception, and a `className`/`maxWidth` escape hatch would simply
  reintroduce the per-page drift this component exists to end. A future
  page that genuinely needs different width behaviour should nest its own
  constraint inside, exactly as Career Memory and Paste Job already do.

  Owns layout only: no data fetching, no hooks, no state, no client
  directive, and nothing about the sidebar, header, modals or chatbot.
*/
export default function AppContent({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full min-w-0 max-w-[1280px] px-5 py-6 sm:px-8">
      {children}
    </div>
  );
}

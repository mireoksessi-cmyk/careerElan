/*
  Phase 6F - the ONE file that knows all 4 templates exist and
  registers them. templateRegistry.ts itself never imports any
  template module directly (spec section 5: "명시적 등록 방식"). Any
  caller that needs the registry populated (Gallery API routes, tests)
  imports this file for its side effect before calling
  getTemplate()/listTemplates()/renderRegisteredTemplate(). Idempotent -
  registerTemplate() overwrites by id, so calling this more than once,
  or after a test calls clearRegistry(), is always safe and correct.

  Bug found via this round's own registry.test.ts: an earlier version
  guarded this with a one-shot module-level `bootstrapped` boolean,
  which went stale the moment any caller (a test) called
  clearRegistry() after the first registration - the flag stayed true
  forever, so every subsequent ensureTemplatesRegistered() call
  silently no-opped against a now-empty registry. Checking the
  registry's OWN actual state instead of a separate flag can't drift
  out of sync with it.
*/
import { registerProfessionalAtsTemplate } from "../templates/professionalAts";
import { registerExecutiveMinimalTemplate } from "../templates/executiveMinimal";
import { registerModernSidebarTemplate } from "../templates/modernSidebar";
import { registerCreativeTimelineTemplate } from "../templates/creativeTimeline";
import { listTemplates } from "./templateRegistry";
import { TEMPLATE_IDS } from "../contracts/types";

export function ensureTemplatesRegistered(): void {
  if (listTemplates().length >= TEMPLATE_IDS.length) return;
  registerProfessionalAtsTemplate();
  registerExecutiveMinimalTemplate();
  registerModernSidebarTemplate();
  registerCreativeTimelineTemplate();
}

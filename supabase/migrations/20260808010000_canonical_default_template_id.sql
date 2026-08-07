-- Phase 6I.2 - Canonical Template Lifecycle Integration.
--
-- career_profiles.default_template_id is the profile-level template
-- preference (spec section 3). Deliberately its own column, not an
-- overload of the existing applications.selected_template_id (which
-- already carries the exact same 4-value CHECK constraint, added in
-- 20260807000000_canonical_generate_package_integration.sql, but is an
-- APPLICATION-level snapshot/override) nor the legacy
-- applications.resume_template_id (a different 4-value set:
-- classic/professional/creative/modern - untouched here).
--
-- NULL until the user explicitly chooses a template - no automatic
-- default. This is what canonicalTemplateGate.ts's hard gate checks:
-- "canonical profile exists AND default_template_id IS NULL" is the
-- TEMPLATE_SELECTION_REQUIRED condition.
alter table public.career_profiles
  add column if not exists default_template_id text;

alter table public.career_profiles
  add constraint career_profiles_default_template_id_check
  check (default_template_id is null or default_template_id in
    ('professional-ats', 'modern-sidebar', 'executive-minimal', 'creative-timeline'));

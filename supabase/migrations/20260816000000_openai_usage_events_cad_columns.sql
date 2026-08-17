/*
  Admin API Usage Phase 2 - adds the two columns needed to persist a
  USD->CAD conversion frozen at event-insert time (see
  lib/openai/currency.ts and lib/openai/telemetry.ts's
  persistUsageEvent()). Both nullable, no default, no backfill:
  existing rows and any future row inserted while
  OPENAI_ACCOUNTING_USD_CAD_RATE is unset simply have NULL here forever
  - "CAD unavailable for this row" is the only honest value, never a
  guessed rate applied after the fact.

  usd_cad_rate is stored alongside estimated_cost_cad (not just the
  converted figure alone) purely for audit traceability - so a future
  reviewer can see exactly which rate produced a given historical CAD
  figure, without needing to reconstruct it from Admin UI copy or a
  separate change log.
*/

alter table public.openai_usage_events
  add column if not exists estimated_cost_cad numeric(12, 6),
  add column if not exists usd_cad_rate numeric(10, 6);

comment on column public.openai_usage_events.estimated_cost_cad is
  'estimated_cost_usd converted to CAD using the OPENAI_ACCOUNTING_USD_CAD_RATE in effect at insert time. NULL when no rate was configured when this row was written - never backfilled or recalculated with a later rate, so historical CAD figures never silently change.';

comment on column public.openai_usage_events.usd_cad_rate is
  'The USD->CAD accounting rate used to compute estimated_cost_cad for this row, frozen at insert time. NULL alongside estimated_cost_cad when no rate was configured.';

/*
  Phase 6F - the Template Registry. An explicit registration map, never
  a hardcoded switch/if-chain over templateId (spec section 5). Empty
  at module load; templates/bootstrap.ts is the one file that imports
  all 4 template renderer modules and calls registerTemplate() for
  each, kept separate from this file so this file (and its tests) never
  needs to know how many templates exist or what their renderer
  implementations look like.
*/
import type { TemplateDefinition } from "../contracts/templateContract";
import type { TemplateCapabilities, TemplateDocxResult, TemplateFormat, TemplateHtmlResult, TemplateId, TemplatePdfResult, TemplateRenderContext } from "../contracts/types";
import { TEMPLATE_IDS } from "../contracts/types";
import { TemplateContractError, assertSupportedDensity, assertSupportedFormat, assertSupportedPaperSize, isKnownTemplateId } from "../contracts/validation";

const registry = new Map<TemplateId, TemplateDefinition>();

/*
  Idempotent by design: re-registering the same id overwrites (useful
  for tests that register a fixture/mock template), never throws on a
  second call for the same id.
*/
export function registerTemplate(definition: TemplateDefinition): void {
  registry.set(definition.capabilities.id, definition);
}

export function clearRegistry(): void {
  registry.clear();
}

export function validateTemplateId(id: string): TemplateId {
  if (!isKnownTemplateId(id, TEMPLATE_IDS)) {
    throw new TemplateContractError("unknown-template-id", `'${id}' is not a known template id. Known ids: ${TEMPLATE_IDS.join(", ")}.`);
  }
  return id;
}

export function getTemplate(id: string): TemplateDefinition {
  const validId = validateTemplateId(id);
  const definition = registry.get(validId);
  if (!definition) {
    throw new TemplateContractError("missing-renderer", `Template '${validId}' is a known id but has not been registered (its renderer module was never loaded).`);
  }
  return definition;
}

export function listTemplates(): TemplateCapabilities[] {
  return Array.from(registry.values()).map((definition) => definition.capabilities);
}

export function getTemplateCapabilities(id: string): TemplateCapabilities {
  return getTemplate(id).capabilities;
}

export async function renderRegisteredTemplate(id: string, context: TemplateRenderContext, format: "html"): Promise<TemplateHtmlResult>;
export async function renderRegisteredTemplate(id: string, context: TemplateRenderContext, format: "pdf"): Promise<TemplatePdfResult>;
export async function renderRegisteredTemplate(id: string, context: TemplateRenderContext, format: "docx"): Promise<TemplateDocxResult>;
export async function renderRegisteredTemplate(id: string, context: TemplateRenderContext, format: TemplateFormat): Promise<TemplateHtmlResult | TemplatePdfResult | TemplateDocxResult> {
  const definition = getTemplate(id);
  assertSupportedFormat(definition.capabilities, format);
  assertSupportedPaperSize(definition.capabilities, context.paperSize);
  assertSupportedDensity(definition.capabilities, context.density);

  if (format === "html") return definition.renderer.renderHtml(context);
  if (format === "pdf") return definition.renderer.renderPdf(context);
  return definition.renderer.renderDocx(context);
}

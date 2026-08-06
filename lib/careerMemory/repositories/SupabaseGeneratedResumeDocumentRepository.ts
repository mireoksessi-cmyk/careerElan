import type { SupabaseClient } from "@supabase/supabase-js";
import type { GeneratedResumeDocumentInsertInput, GeneratedResumeDocumentRow } from "../persistence/types";
import type { GeneratedResumeDocumentRepository } from "../persistence/repositories";
import { CAREER_MEMORY_TABLE_NAMES } from "../persistence/constants";
import { unwrapList, unwrapMaybe, unwrapSingle, unwrapVoid } from "./queryHelpers";

const TABLE = CAREER_MEMORY_TABLE_NAMES.generatedResumeDocuments;

export class SupabaseGeneratedResumeDocumentRepository implements GeneratedResumeDocumentRepository {
  constructor(private readonly client: SupabaseClient) {}

  async getById(id: string): Promise<GeneratedResumeDocumentRow | null> {
    const result = await this.client.from(TABLE).select("*").eq("id", id).maybeSingle();
    return unwrapMaybe(result as never, "GeneratedResumeDocumentRepository.getById");
  }

  async listByTailoredResumeId(tailoredResumeId: string): Promise<GeneratedResumeDocumentRow[]> {
    const result = await this.client.from(TABLE).select("*").eq("tailored_resume_id", tailoredResumeId).order("created_at", { ascending: false });
    return unwrapList(result as never, "GeneratedResumeDocumentRepository.listByTailoredResumeId");
  }

  async insert(input: GeneratedResumeDocumentInsertInput): Promise<GeneratedResumeDocumentRow> {
    const result = await this.client.from(TABLE).insert(input).select("*").single();
    return unwrapSingle(result as never, "GeneratedResumeDocumentRepository.insert");
  }

  async delete(id: string): Promise<void> {
    const result = await this.client.from(TABLE).delete().eq("id", id);
    return unwrapVoid(result as never, "GeneratedResumeDocumentRepository.delete");
  }
}

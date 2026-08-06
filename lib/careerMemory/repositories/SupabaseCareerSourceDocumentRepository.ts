import type { SupabaseClient } from "@supabase/supabase-js";
import type { CareerSourceDocumentInsertInput, CareerSourceDocumentRow, CareerSourceDocumentUpdateInput, SourceDocumentAnalysisStatus } from "../persistence/types";
import type { ExtendedCareerSourceDocumentRepository } from "./extendedInterfaces";
import { CAREER_MEMORY_TABLE_NAMES } from "../persistence/constants";
import { unwrapList, unwrapMaybe, unwrapSingle, unwrapVoid } from "./queryHelpers";

const TABLE = CAREER_MEMORY_TABLE_NAMES.careerSourceDocuments;

export class SupabaseCareerSourceDocumentRepository implements ExtendedCareerSourceDocumentRepository {
  constructor(private readonly client: SupabaseClient) {}

  async getById(id: string): Promise<CareerSourceDocumentRow | null> {
    const result = await this.client.from(TABLE).select("*").eq("id", id).maybeSingle();
    return unwrapMaybe(result as never, "CareerSourceDocumentRepository.getById");
  }

  async listByProfileId(profileId: string): Promise<CareerSourceDocumentRow[]> {
    const result = await this.client.from(TABLE).select("*").eq("profile_id", profileId).order("created_at", { ascending: true });
    return unwrapList(result as never, "CareerSourceDocumentRepository.listByProfileId");
  }

  async findByContentHash(profileId: string, contentHash: string): Promise<CareerSourceDocumentRow | null> {
    const result = await this.client.from(TABLE).select("*").eq("profile_id", profileId).eq("content_hash", contentHash).maybeSingle();
    return unwrapMaybe(result as never, "CareerSourceDocumentRepository.findByContentHash");
  }

  /* analysis_status defaults to "pending" here explicitly, matching the
     migration's own `analysis_status text not null default 'pending'`
     (supabase/migrations/20260806010000_career_memory_persistence_layer.sql) -
     PostgREST/Postgres would apply that default anyway when the column
     is omitted from a real insert, but making it explicit here keeps
     the repository's own behavior self-documenting and testable
     without requiring a fake client to simulate column defaults. */
  async insert(input: CareerSourceDocumentInsertInput): Promise<CareerSourceDocumentRow> {
    const result = await this.client
      .from(TABLE)
      .insert({ ...input, analysis_status: input.analysis_status ?? "pending" })
      .select("*")
      .single();
    return unwrapSingle(result as never, "CareerSourceDocumentRepository.insert");
  }

  async update(id: string, input: CareerSourceDocumentUpdateInput): Promise<CareerSourceDocumentRow> {
    const result = await this.client.from(TABLE).update(input).eq("id", id).select("*").single();
    return unwrapSingle(result as never, "CareerSourceDocumentRepository.update");
  }

  async updateAnalysisStatus(id: string, status: SourceDocumentAnalysisStatus): Promise<CareerSourceDocumentRow> {
    return this.update(id, { analysis_status: status });
  }

  async delete(id: string): Promise<void> {
    const result = await this.client.from(TABLE).delete().eq("id", id);
    return unwrapVoid(result as never, "CareerSourceDocumentRepository.delete");
  }
}

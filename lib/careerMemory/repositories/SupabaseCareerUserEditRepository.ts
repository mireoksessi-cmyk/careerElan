import type { SupabaseClient } from "@supabase/supabase-js";
import type { CareerUserEditInsertInput, CareerUserEditRow } from "../persistence/types";
import type { CareerUserEditRepository } from "../persistence/repositories";
import { CAREER_MEMORY_TABLE_NAMES } from "../persistence/constants";
import { unwrapList, unwrapMaybe, unwrapSingle } from "./queryHelpers";

const TABLE = CAREER_MEMORY_TABLE_NAMES.careerUserEdits;

/* No update()/delete() - career_user_edits is a pure append-only audit
   log, matching the base interface's own header comment. */
export class SupabaseCareerUserEditRepository implements CareerUserEditRepository {
  constructor(private readonly client: SupabaseClient) {}

  async getById(id: string): Promise<CareerUserEditRow | null> {
    const result = await this.client.from(TABLE).select("*").eq("id", id).maybeSingle();
    return unwrapMaybe(result as never, "CareerUserEditRepository.getById");
  }

  async listByProfileId(profileId: string): Promise<CareerUserEditRow[]> {
    const result = await this.client.from(TABLE).select("*").eq("profile_id", profileId).order("edited_at", { ascending: false });
    return unwrapList(result as never, "CareerUserEditRepository.listByProfileId");
  }

  async listByTarget(targetTable: string, targetId: string): Promise<CareerUserEditRow[]> {
    const result = await this.client.from(TABLE).select("*").eq("target_table", targetTable).eq("target_id", targetId).order("edited_at", { ascending: false });
    return unwrapList(result as never, "CareerUserEditRepository.listByTarget");
  }

  async insert(input: CareerUserEditInsertInput): Promise<CareerUserEditRow> {
    const result = await this.client.from(TABLE).insert(input).select("*").single();
    return unwrapSingle(result as never, "CareerUserEditRepository.insert");
  }
}

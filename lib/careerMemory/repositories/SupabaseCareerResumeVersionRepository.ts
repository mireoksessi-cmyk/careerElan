import type { SupabaseClient } from "@supabase/supabase-js";
import type { CareerResumeVersionInsertInput, CareerResumeVersionRow } from "../persistence/types";
import type { CareerResumeVersionRepository } from "../persistence/repositories";
import { CAREER_MEMORY_TABLE_NAMES } from "../persistence/constants";
import { unwrapList, unwrapMaybe, unwrapSingle, unwrapVoid } from "./queryHelpers";

const TABLE = CAREER_MEMORY_TABLE_NAMES.careerResumeVersions;

/* No update() - career_resume_versions is append-only, matching the
   base interface's own header comment (Phase 6A.2 Versioning Contract:
   a version is never edited in place after creation). */
export class SupabaseCareerResumeVersionRepository implements CareerResumeVersionRepository {
  constructor(private readonly client: SupabaseClient) {}

  async getById(id: string): Promise<CareerResumeVersionRow | null> {
    const result = await this.client.from(TABLE).select("*").eq("id", id).maybeSingle();
    return unwrapMaybe(result as never, "CareerResumeVersionRepository.getById");
  }

  async listByProfileId(profileId: string): Promise<CareerResumeVersionRow[]> {
    const result = await this.client.from(TABLE).select("*").eq("profile_id", profileId).order("created_at", { ascending: false });
    return unwrapList(result as never, "CareerResumeVersionRepository.listByProfileId");
  }

  async getLatestByProfileId(profileId: string): Promise<CareerResumeVersionRow | null> {
    const result = await this.client.from(TABLE).select("*").eq("profile_id", profileId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    return unwrapMaybe(result as never, "CareerResumeVersionRepository.getLatestByProfileId");
  }

  async insert(input: CareerResumeVersionInsertInput): Promise<CareerResumeVersionRow> {
    const result = await this.client.from(TABLE).insert(input).select("*").single();
    return unwrapSingle(result as never, "CareerResumeVersionRepository.insert");
  }

  async delete(id: string): Promise<void> {
    const result = await this.client.from(TABLE).delete().eq("id", id);
    return unwrapVoid(result as never, "CareerResumeVersionRepository.delete");
  }
}

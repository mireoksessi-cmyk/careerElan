import type { SupabaseClient } from "@supabase/supabase-js";
import type { CareerTailoredResumeInsertInput, CareerTailoredResumeRow, CareerTailoredResumeUpdateInput } from "../persistence/types";
import type { CareerTailoredResumeRepository } from "../persistence/repositories";
import { CAREER_MEMORY_TABLE_NAMES } from "../persistence/constants";
import { unwrapList, unwrapMaybe, unwrapSingle, unwrapVoid } from "./queryHelpers";

const TABLE = CAREER_MEMORY_TABLE_NAMES.careerTailoredResumes;

/*
  update() exists on the base interface for template_id/ai_model/
  prompt_version bookkeeping edits, but services/canonicalOverlayService.ts
  never calls it to change the `overlay` column itself - see that
  file's own header comment (§14: "canonical row 수정 메서드 금지" is about
  the OVERLAY payload specifically, not the row's other metadata
  columns).
*/
export class SupabaseCareerTailoredResumeRepository implements CareerTailoredResumeRepository {
  constructor(private readonly client: SupabaseClient) {}

  async getById(id: string): Promise<CareerTailoredResumeRow | null> {
    const result = await this.client.from(TABLE).select("*").eq("id", id).maybeSingle();
    return unwrapMaybe(result as never, "CareerTailoredResumeRepository.getById");
  }

  async listByProfileId(profileId: string): Promise<CareerTailoredResumeRow[]> {
    const result = await this.client.from(TABLE).select("*").eq("profile_id", profileId).order("created_at", { ascending: true });
    return unwrapList(result as never, "CareerTailoredResumeRepository.listByProfileId");
  }

  async getByApplicationId(applicationId: string): Promise<CareerTailoredResumeRow | null> {
    const result = await this.client.from(TABLE).select("*").eq("application_id", applicationId).maybeSingle();
    return unwrapMaybe(result as never, "CareerTailoredResumeRepository.getByApplicationId");
  }

  async insert(input: CareerTailoredResumeInsertInput): Promise<CareerTailoredResumeRow> {
    const result = await this.client.from(TABLE).insert(input).select("*").single();
    return unwrapSingle(result as never, "CareerTailoredResumeRepository.insert");
  }

  async update(id: string, input: CareerTailoredResumeUpdateInput): Promise<CareerTailoredResumeRow> {
    const result = await this.client.from(TABLE).update(input).eq("id", id).select("*").single();
    return unwrapSingle(result as never, "CareerTailoredResumeRepository.update");
  }

  async delete(id: string): Promise<void> {
    const result = await this.client.from(TABLE).delete().eq("id", id);
    return unwrapVoid(result as never, "CareerTailoredResumeRepository.delete");
  }
}

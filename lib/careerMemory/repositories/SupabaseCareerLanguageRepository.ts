import type { SupabaseClient } from "@supabase/supabase-js";
import type { CareerLanguageInsertInput, CareerLanguageRow, CareerLanguageUpdateInput } from "../persistence/types";
import type { ExtendedCareerLanguageRepository } from "./extendedInterfaces";
import { CAREER_MEMORY_TABLE_NAMES } from "../persistence/constants";
import { unwrapList, unwrapMaybe, unwrapSingle, unwrapVoid } from "./queryHelpers";

const TABLE = CAREER_MEMORY_TABLE_NAMES.careerLanguages;

/* career_languages has no Runtime-side source (see Phase 6C's own
   disclosed gap - ResumeStructuredModel has no `languages` field) -
   this repository is fully implemented and usable on its own, but the
   canonical save workflow never calls replaceForProfile() for it
   (nothing to replace it WITH), matching that documented limitation. */
export class SupabaseCareerLanguageRepository implements ExtendedCareerLanguageRepository {
  constructor(private readonly client: SupabaseClient) {}

  async getById(id: string): Promise<CareerLanguageRow | null> {
    const result = await this.client.from(TABLE).select("*").eq("id", id).maybeSingle();
    return unwrapMaybe(result as never, "CareerLanguageRepository.getById");
  }

  async listByProfileId(profileId: string): Promise<CareerLanguageRow[]> {
    const result = await this.client.from(TABLE).select("*").eq("profile_id", profileId).order("sort_order", { ascending: true }).order("created_at", { ascending: true });
    return unwrapList(result as never, "CareerLanguageRepository.listByProfileId");
  }

  async insert(input: CareerLanguageInsertInput): Promise<CareerLanguageRow> {
    const result = await this.client.from(TABLE).insert(input).select("*").single();
    return unwrapSingle(result as never, "CareerLanguageRepository.insert");
  }

  async update(id: string, input: CareerLanguageUpdateInput): Promise<CareerLanguageRow> {
    const result = await this.client.from(TABLE).update(input).eq("id", id).select("*").single();
    return unwrapSingle(result as never, "CareerLanguageRepository.update");
  }

  async delete(id: string): Promise<void> {
    const result = await this.client.from(TABLE).delete().eq("id", id);
    return unwrapVoid(result as never, "CareerLanguageRepository.delete");
  }

  async deleteByProfileId(profileId: string): Promise<void> {
    const result = await this.client.from(TABLE).delete().eq("profile_id", profileId);
    return unwrapVoid(result as never, "CareerLanguageRepository.deleteByProfileId");
  }

  async replaceForProfile(profileId: string, inputs: CareerLanguageInsertInput[]): Promise<CareerLanguageRow[]> {
    await this.deleteByProfileId(profileId);
    if (inputs.length === 0) return [];
    const result = await this.client.from(TABLE).insert(inputs).select("*");
    return unwrapList(result as never, "CareerLanguageRepository.replaceForProfile");
  }
}

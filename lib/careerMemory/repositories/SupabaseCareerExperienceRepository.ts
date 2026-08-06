import type { SupabaseClient } from "@supabase/supabase-js";
import type { CareerExperienceInsertInput, CareerExperienceRow, CareerExperienceUpdateInput } from "../persistence/types";
import type { ExtendedCareerExperienceRepository } from "./extendedInterfaces";
import { CAREER_MEMORY_TABLE_NAMES } from "../persistence/constants";
import { unwrapList, unwrapMaybe, unwrapSingle, unwrapVoid } from "./queryHelpers";

const TABLE = CAREER_MEMORY_TABLE_NAMES.careerExperiences;

export class SupabaseCareerExperienceRepository implements ExtendedCareerExperienceRepository {
  constructor(private readonly client: SupabaseClient) {}

  async getById(id: string): Promise<CareerExperienceRow | null> {
    const result = await this.client.from(TABLE).select("*").eq("id", id).maybeSingle();
    return unwrapMaybe(result as never, "CareerExperienceRepository.getById");
  }

  async listByProfileId(profileId: string): Promise<CareerExperienceRow[]> {
    const result = await this.client.from(TABLE).select("*").eq("profile_id", profileId).order("sort_order", { ascending: true }).order("created_at", { ascending: true });
    return unwrapList(result as never, "CareerExperienceRepository.listByProfileId");
  }

  async insert(input: CareerExperienceInsertInput): Promise<CareerExperienceRow> {
    const result = await this.client.from(TABLE).insert(input).select("*").single();
    return unwrapSingle(result as never, "CareerExperienceRepository.insert");
  }

  async update(id: string, input: CareerExperienceUpdateInput): Promise<CareerExperienceRow> {
    const result = await this.client.from(TABLE).update(input).eq("id", id).select("*").single();
    return unwrapSingle(result as never, "CareerExperienceRepository.update");
  }

  async delete(id: string): Promise<void> {
    const result = await this.client.from(TABLE).delete().eq("id", id);
    return unwrapVoid(result as never, "CareerExperienceRepository.delete");
  }

  async deleteByProfileId(profileId: string): Promise<void> {
    const result = await this.client.from(TABLE).delete().eq("profile_id", profileId);
    return unwrapVoid(result as never, "CareerExperienceRepository.deleteByProfileId");
  }

  /*
    Delete-then-insert, NOT a real transaction (see
    lib/careerMemory/transactions/README.md's own disclosed
    TRANSACTION_SCHEMA_GAP) - a crash between the two calls leaves the
    profile with zero experience rows until the caller retries. Callers
    needing atomicity must wait for a future RPC-based round; this
    method's own doc comment and the service layer that calls it both
    say so explicitly, not just this file.
  */
  async replaceForProfile(profileId: string, inputs: CareerExperienceInsertInput[]): Promise<CareerExperienceRow[]> {
    await this.deleteByProfileId(profileId);
    if (inputs.length === 0) return [];
    const result = await this.client.from(TABLE).insert(inputs).select("*");
    return unwrapList(result as never, "CareerExperienceRepository.replaceForProfile");
  }
}

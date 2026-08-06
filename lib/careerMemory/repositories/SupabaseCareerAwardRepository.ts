import type { SupabaseClient } from "@supabase/supabase-js";
import type { CareerAwardInsertInput, CareerAwardRow, CareerAwardUpdateInput } from "../persistence/types";
import type { ExtendedCareerAwardRepository } from "./extendedInterfaces";
import { CAREER_MEMORY_TABLE_NAMES } from "../persistence/constants";
import { unwrapList, unwrapMaybe, unwrapSingle, unwrapVoid } from "./queryHelpers";

const TABLE = CAREER_MEMORY_TABLE_NAMES.careerAwards;

export class SupabaseCareerAwardRepository implements ExtendedCareerAwardRepository {
  constructor(private readonly client: SupabaseClient) {}

  async getById(id: string): Promise<CareerAwardRow | null> {
    const result = await this.client.from(TABLE).select("*").eq("id", id).maybeSingle();
    return unwrapMaybe(result as never, "CareerAwardRepository.getById");
  }

  async listByProfileId(profileId: string): Promise<CareerAwardRow[]> {
    const result = await this.client.from(TABLE).select("*").eq("profile_id", profileId).order("sort_order", { ascending: true }).order("created_at", { ascending: true });
    return unwrapList(result as never, "CareerAwardRepository.listByProfileId");
  }

  async insert(input: CareerAwardInsertInput): Promise<CareerAwardRow> {
    const result = await this.client.from(TABLE).insert(input).select("*").single();
    return unwrapSingle(result as never, "CareerAwardRepository.insert");
  }

  async update(id: string, input: CareerAwardUpdateInput): Promise<CareerAwardRow> {
    const result = await this.client.from(TABLE).update(input).eq("id", id).select("*").single();
    return unwrapSingle(result as never, "CareerAwardRepository.update");
  }

  async delete(id: string): Promise<void> {
    const result = await this.client.from(TABLE).delete().eq("id", id);
    return unwrapVoid(result as never, "CareerAwardRepository.delete");
  }

  async deleteByProfileId(profileId: string): Promise<void> {
    const result = await this.client.from(TABLE).delete().eq("profile_id", profileId);
    return unwrapVoid(result as never, "CareerAwardRepository.deleteByProfileId");
  }

  async replaceForProfile(profileId: string, inputs: CareerAwardInsertInput[]): Promise<CareerAwardRow[]> {
    await this.deleteByProfileId(profileId);
    if (inputs.length === 0) return [];
    const result = await this.client.from(TABLE).insert(inputs).select("*");
    return unwrapList(result as never, "CareerAwardRepository.replaceForProfile");
  }
}

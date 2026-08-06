import type { SupabaseClient } from "@supabase/supabase-js";
import type { CareerProjectInsertInput, CareerProjectRow, CareerProjectUpdateInput } from "../persistence/types";
import type { ExtendedCareerProjectRepository } from "./extendedInterfaces";
import { CAREER_MEMORY_TABLE_NAMES } from "../persistence/constants";
import { unwrapList, unwrapMaybe, unwrapSingle, unwrapVoid } from "./queryHelpers";

const TABLE = CAREER_MEMORY_TABLE_NAMES.careerProjects;

export class SupabaseCareerProjectRepository implements ExtendedCareerProjectRepository {
  constructor(private readonly client: SupabaseClient) {}

  async getById(id: string): Promise<CareerProjectRow | null> {
    const result = await this.client.from(TABLE).select("*").eq("id", id).maybeSingle();
    return unwrapMaybe(result as never, "CareerProjectRepository.getById");
  }

  async listByProfileId(profileId: string): Promise<CareerProjectRow[]> {
    const result = await this.client.from(TABLE).select("*").eq("profile_id", profileId).order("sort_order", { ascending: true }).order("created_at", { ascending: true });
    return unwrapList(result as never, "CareerProjectRepository.listByProfileId");
  }

  async insert(input: CareerProjectInsertInput): Promise<CareerProjectRow> {
    const result = await this.client.from(TABLE).insert(input).select("*").single();
    return unwrapSingle(result as never, "CareerProjectRepository.insert");
  }

  async update(id: string, input: CareerProjectUpdateInput): Promise<CareerProjectRow> {
    const result = await this.client.from(TABLE).update(input).eq("id", id).select("*").single();
    return unwrapSingle(result as never, "CareerProjectRepository.update");
  }

  async delete(id: string): Promise<void> {
    const result = await this.client.from(TABLE).delete().eq("id", id);
    return unwrapVoid(result as never, "CareerProjectRepository.delete");
  }

  async deleteByProfileId(profileId: string): Promise<void> {
    const result = await this.client.from(TABLE).delete().eq("profile_id", profileId);
    return unwrapVoid(result as never, "CareerProjectRepository.deleteByProfileId");
  }

  async replaceForProfile(profileId: string, inputs: CareerProjectInsertInput[]): Promise<CareerProjectRow[]> {
    await this.deleteByProfileId(profileId);
    if (inputs.length === 0) return [];
    const result = await this.client.from(TABLE).insert(inputs).select("*");
    return unwrapList(result as never, "CareerProjectRepository.replaceForProfile");
  }
}

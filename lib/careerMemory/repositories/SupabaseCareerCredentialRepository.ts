import type { SupabaseClient } from "@supabase/supabase-js";
import type { CareerCredentialInsertInput, CareerCredentialRow, CareerCredentialUpdateInput } from "../persistence/types";
import type { ExtendedCareerCredentialRepository } from "./extendedInterfaces";
import { CAREER_MEMORY_TABLE_NAMES } from "../persistence/constants";
import { unwrapList, unwrapMaybe, unwrapSingle, unwrapVoid } from "./queryHelpers";

const TABLE = CAREER_MEMORY_TABLE_NAMES.careerCredentials;

export class SupabaseCareerCredentialRepository implements ExtendedCareerCredentialRepository {
  constructor(private readonly client: SupabaseClient) {}

  async getById(id: string): Promise<CareerCredentialRow | null> {
    const result = await this.client.from(TABLE).select("*").eq("id", id).maybeSingle();
    return unwrapMaybe(result as never, "CareerCredentialRepository.getById");
  }

  async listByProfileId(profileId: string): Promise<CareerCredentialRow[]> {
    const result = await this.client.from(TABLE).select("*").eq("profile_id", profileId).order("sort_order", { ascending: true }).order("created_at", { ascending: true });
    return unwrapList(result as never, "CareerCredentialRepository.listByProfileId");
  }

  async insert(input: CareerCredentialInsertInput): Promise<CareerCredentialRow> {
    const result = await this.client.from(TABLE).insert(input).select("*").single();
    return unwrapSingle(result as never, "CareerCredentialRepository.insert");
  }

  async update(id: string, input: CareerCredentialUpdateInput): Promise<CareerCredentialRow> {
    const result = await this.client.from(TABLE).update(input).eq("id", id).select("*").single();
    return unwrapSingle(result as never, "CareerCredentialRepository.update");
  }

  async delete(id: string): Promise<void> {
    const result = await this.client.from(TABLE).delete().eq("id", id);
    return unwrapVoid(result as never, "CareerCredentialRepository.delete");
  }

  async deleteByProfileId(profileId: string): Promise<void> {
    const result = await this.client.from(TABLE).delete().eq("profile_id", profileId);
    return unwrapVoid(result as never, "CareerCredentialRepository.deleteByProfileId");
  }

  async replaceForProfile(profileId: string, inputs: CareerCredentialInsertInput[]): Promise<CareerCredentialRow[]> {
    await this.deleteByProfileId(profileId);
    if (inputs.length === 0) return [];
    const result = await this.client.from(TABLE).insert(inputs).select("*");
    return unwrapList(result as never, "CareerCredentialRepository.replaceForProfile");
  }
}

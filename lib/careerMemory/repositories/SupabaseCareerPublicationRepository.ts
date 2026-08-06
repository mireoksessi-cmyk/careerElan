import type { SupabaseClient } from "@supabase/supabase-js";
import type { CareerPublicationInsertInput, CareerPublicationRow, CareerPublicationUpdateInput } from "../persistence/types";
import type { ExtendedCareerPublicationRepository } from "./extendedInterfaces";
import { CAREER_MEMORY_TABLE_NAMES } from "../persistence/constants";
import { unwrapList, unwrapMaybe, unwrapSingle, unwrapVoid } from "./queryHelpers";

const TABLE = CAREER_MEMORY_TABLE_NAMES.careerPublications;

export class SupabaseCareerPublicationRepository implements ExtendedCareerPublicationRepository {
  constructor(private readonly client: SupabaseClient) {}

  async getById(id: string): Promise<CareerPublicationRow | null> {
    const result = await this.client.from(TABLE).select("*").eq("id", id).maybeSingle();
    return unwrapMaybe(result as never, "CareerPublicationRepository.getById");
  }

  async listByProfileId(profileId: string): Promise<CareerPublicationRow[]> {
    const result = await this.client.from(TABLE).select("*").eq("profile_id", profileId).order("sort_order", { ascending: true }).order("created_at", { ascending: true });
    return unwrapList(result as never, "CareerPublicationRepository.listByProfileId");
  }

  async insert(input: CareerPublicationInsertInput): Promise<CareerPublicationRow> {
    const result = await this.client.from(TABLE).insert(input).select("*").single();
    return unwrapSingle(result as never, "CareerPublicationRepository.insert");
  }

  async update(id: string, input: CareerPublicationUpdateInput): Promise<CareerPublicationRow> {
    const result = await this.client.from(TABLE).update(input).eq("id", id).select("*").single();
    return unwrapSingle(result as never, "CareerPublicationRepository.update");
  }

  async delete(id: string): Promise<void> {
    const result = await this.client.from(TABLE).delete().eq("id", id);
    return unwrapVoid(result as never, "CareerPublicationRepository.delete");
  }

  async deleteByProfileId(profileId: string): Promise<void> {
    const result = await this.client.from(TABLE).delete().eq("profile_id", profileId);
    return unwrapVoid(result as never, "CareerPublicationRepository.deleteByProfileId");
  }

  async replaceForProfile(profileId: string, inputs: CareerPublicationInsertInput[]): Promise<CareerPublicationRow[]> {
    await this.deleteByProfileId(profileId);
    if (inputs.length === 0) return [];
    const result = await this.client.from(TABLE).insert(inputs).select("*");
    return unwrapList(result as never, "CareerPublicationRepository.replaceForProfile");
  }
}

/*
  Phase 6D - concrete CareerProfileRepository. Supabase client is
  constructor-injected (never a global singleton import) so a test can
  hand this class a fake client instead - see
  repositories/testSupport/fakeSupabaseClient.ts.
*/
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CareerProfileInsertInput, CareerProfileRow, CareerProfileUpdateInput } from "../persistence/types";
import type { CareerProfileRepository } from "../persistence/repositories";
import { CAREER_MEMORY_TABLE_NAMES } from "../persistence/constants";
import { unwrapMaybe, unwrapSingle, unwrapVoid } from "./queryHelpers";

const TABLE = CAREER_MEMORY_TABLE_NAMES.careerProfiles;

export class SupabaseCareerProfileRepository implements CareerProfileRepository {
  constructor(private readonly client: SupabaseClient) {}

  async getById(id: string): Promise<CareerProfileRow | null> {
    const result = await this.client.from(TABLE).select("*").eq("id", id).maybeSingle();
    return unwrapMaybe(result as never, "CareerProfileRepository.getById");
  }

  async getByUserId(userId: string): Promise<CareerProfileRow | null> {
    const result = await this.client.from(TABLE).select("*").eq("user_id", userId).maybeSingle();
    return unwrapMaybe(result as never, "CareerProfileRepository.getByUserId");
  }

  async insert(input: CareerProfileInsertInput): Promise<CareerProfileRow> {
    const result = await this.client.from(TABLE).insert(input).select("*").single();
    return unwrapSingle(result as never, "CareerProfileRepository.insert");
  }

  async update(id: string, input: CareerProfileUpdateInput): Promise<CareerProfileRow> {
    const result = await this.client.from(TABLE).update(input).eq("id", id).select("*").single();
    return unwrapSingle(result as never, "CareerProfileRepository.update");
  }

  async delete(id: string): Promise<void> {
    const result = await this.client.from(TABLE).delete().eq("id", id);
    return unwrapVoid(result as never, "CareerProfileRepository.delete");
  }
}

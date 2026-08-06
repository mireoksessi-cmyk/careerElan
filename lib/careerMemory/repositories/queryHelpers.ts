/*
  Phase 6D - shared PostgREST call helpers. Every concrete repository
  below builds its query chain itself (table/columns/filters differ per
  repository) but hands the FINAL awaited `{data, error}` result to one
  of these three functions, so error mapping (mapPostgrestError) is
  applied exactly once, consistently, everywhere - no repository method
  inlines its own `if (error) throw ...`.
*/
import { mapPostgrestError, type PostgrestErrorLike } from "./postgrestErrors";

type Result<T> = { data: T | null; error: PostgrestErrorLike | null };

export async function unwrapSingle<T>(result: Result<T>, context: string): Promise<T> {
  if (result.error) throw mapPostgrestError(result.error, context);
  if (result.data === null) throw mapPostgrestError({ message: "no row returned", code: undefined }, context);
  return result.data;
}

export async function unwrapMaybe<T>(result: Result<T>, context: string): Promise<T | null> {
  if (result.error) throw mapPostgrestError(result.error, context);
  return result.data;
}

export async function unwrapList<T>(result: Result<T[]>, context: string): Promise<T[]> {
  if (result.error) throw mapPostgrestError(result.error, context);
  return result.data ?? [];
}

export async function unwrapVoid(result: { error: PostgrestErrorLike | null }, context: string): Promise<void> {
  if (result.error) throw mapPostgrestError(result.error, context);
}

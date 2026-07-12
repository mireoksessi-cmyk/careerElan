import { supabase } from "@/lib/supabase";

/* ---------- OAuth ---------- */

export function signInWithGoogle() {
  return supabase.auth.signInWithOAuth({
    provider: "google",
  });
}

export function signInWithLinkedIn() {
  return supabase.auth.signInWithOAuth({
    provider: "linkedin_oidc",
  });
}

export function signInWithFacebook() {
  return supabase.auth.signInWithOAuth({
    provider: "facebook",
  });
}

/* ---------- Email ---------- */

export function signUp(
  email: string,
  password: string
) {
  return supabase.auth.signUp({
    email,
    password,
  });
}

export function signIn(
  email: string,
  password: string
) {
  return supabase.auth.signInWithPassword({
    email,
    password,
  });
}

export function resetPassword(email: string) {
  return supabase.auth.resetPasswordForEmail(email);
}

/* ---------- Common ---------- */

export function signOut() {
  return supabase.auth.signOut();
}

export async function getSession() {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  return session;
}

export async function getUser() {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user;
}
import { supabase } from "@/lib/supabase";

/* ---------- Types ---------- */

export type SignInResult = {
  user: NonNullable<
    Awaited<
      ReturnType<typeof supabase.auth.signInWithPassword>
    >["data"]["user"]
  >;
  redirectTo: "/dashboard" | "/career-memory";
};

/* ---------- OAuth ---------- */

export function signInWithGoogle() {
  return supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
    },
  });
}

export function signInWithLinkedIn() {
  return supabase.auth.signInWithOAuth({
    provider: "linkedin_oidc",
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
    },
  });
}

export function signInWithFacebook() {
  return supabase.auth.signInWithOAuth({
    provider: "facebook",
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
    },
  });
}

/* ---------- Email ---------- */

export function signUp(
  email: string,
  password: string
) {
  return supabase.auth.signUp({
    email: email.trim(),
    password,
  });
}

export async function signIn(
  email: string,
  password: string
): Promise<SignInResult> {
  const { data, error } =
    await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

  if (error) {
    throw error;
  }

  if (!data.user) {
    throw new Error("Unable to load your account.");
  }

  const { data: memory, error: memoryError } =
    await supabase
      .from("career_memory")
      .select("required_completed")
      .eq("user_id", data.user.id)
      .maybeSingle();

  if (memoryError) {
    console.error(
      "CAREER MEMORY CHECK ERROR =",
      memoryError
    );

    /*
      로그인 자체는 성공했으므로 오류가 발생해도
      Dashboard로 보내지 않고 Career Memory로 보낸다.
    */
    return {
      user: data.user,
      redirectTo: "/career-memory",
    };
  }

  return {
    user: data.user,
    redirectTo:
      memory?.required_completed === true
        ? "/dashboard"
        : "/career-memory",
  };
}

export function resetPassword(email: string) {
  return supabase.auth.resetPasswordForEmail(
    email.trim()
  );
}

/* ---------- Common ---------- */

export function signOut() {
  return supabase.auth.signOut();
}

export async function getSession() {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error) {
    throw error;
  }

  return session;
}

export async function getUser() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    throw error;
  }

  return user;
}
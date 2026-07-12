"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

const AuthContext = createContext({
  user: null as User | null,
  loading: true,
});

export function AuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data, error }) => {
  console.log("SESSION =", data);
  console.log("SESSION ERROR =", error);
});
    supabase.auth.getUser().then(({ data, error }) => {
  console.log("GET USER =", data.user);
  console.log("GET USER ERROR =", error);

  setUser(data.user);
  setLoading(false);
});

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
  console.log("AUTH EVENT =", event);
  console.log("SESSION =", session);

  setUser(session?.user ?? null);
});
     
    return () => subscription.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
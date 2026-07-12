"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";

import { supabase } from "@/lib/supabase";

type LoginContextType = {
  loading: boolean;

  user: any;

  profile: any;

  careerMemory: any;

  resumes: any[];

  coverLetters: any[];

  refresh: () => Promise<void>;
};

const LoginContext = createContext<LoginContextType>({
  loading: true,

  user: null,

  profile: null,

  careerMemory: null,

  resumes: [],

  coverLetters: [],

  refresh: async () => {},
});

export function LoginManager({
  children,
}: {
  children: ReactNode;
}) {
  const [loading, setLoading] = useState(true);

  const [user, setUser] = useState<any>(null);

  const [profile, setProfile] = useState<any>(null);

  const [careerMemory, setCareerMemory] = useState<any>(null);

  const [resumes, setResumes] = useState<any[]>([]);

  const [coverLetters, setCoverLetters] =
    useState<any[]>([]);

  useEffect(() => {
    refresh();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      refresh();
    });

    return () => subscription.unsubscribe();
  }, []);

  async function refresh() {
    setLoading(true);

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      setUser(null);
      setProfile(null);
      setCareerMemory(null);
      setResumes([]);
      setCoverLetters([]);
      setLoading(false);
      return;
    }

    const currentUser = session.user;

    setUser(currentUser);

    const [{ data: profile }, { data: careerMemory }, { data: resumes }, { data: coverLetters }] =
      await Promise.all([
        supabase
          .from("profiles")
          .select("*")
          .eq("id", currentUser.id)
          .maybeSingle(),

        supabase
          .from("career_memory")
          .select("*")
          .eq("user_id", currentUser.id)
          .maybeSingle(),

        supabase
          .from("resumes")
          .select("*")
          .eq("user_id", currentUser.id)
          .order("created_at", {
            ascending: false,
          }),

        supabase
          .from("cover_letters")
          .select("*")
          .eq("user_id", currentUser.id)
          .order("created_at", {
            ascending: false,
          }),
      ]);

    setProfile(profile);

    setCareerMemory(careerMemory);

    setResumes(resumes ?? []);

    setCoverLetters(coverLetters ?? []);

    setLoading(false);
  }

  return (
    <LoginContext.Provider
      value={{
        loading,

        user,

        profile,

        careerMemory,

        resumes,

        coverLetters,

        refresh,
      }}
    >
      {children}
    </LoginContext.Provider>
  );
}

export function useLogin() {
  return useContext(LoginContext);
}
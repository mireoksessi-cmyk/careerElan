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

  hasResumeData: boolean;

  refresh: () => Promise<void>;
};

const LoginContext = createContext<LoginContextType>({
  loading: true,

  user: null,

  profile: null,

  careerMemory: null,

  resumes: [],

  coverLetters: [],

  hasResumeData: false,

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

  const [hasResumeData, setHasResumeData] =
    useState(false);

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
      setHasResumeData(false);
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

    /*
      직접 작성(career_memory 필수 항목 완료) 또는
      업로드(resumes 행 존재) 둘 중 하나라도 되어 있으면
      이력서 데이터가 있는 것으로 간주한다.
    */
    setHasResumeData(
      Boolean(careerMemory?.required_completed) ||
        (resumes ?? []).length > 0
    );

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

        hasResumeData,

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
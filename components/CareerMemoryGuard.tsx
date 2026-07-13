"use client";

import { ReactNode, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useLogin } from "@/lib/auth/LoginManager";

type CareerMemoryGuardProps = {
  children: ReactNode;
};

export default function CareerMemoryGuard({
  children,
}: CareerMemoryGuardProps) {
  const router = useRouter();

  const {
    user,
    loading,
    careerMemory,
  } = useLogin();

  const isCompleted =
    careerMemory?.required_completed === true;

  useEffect(() => {
    if (loading) return;

    if (!user) {
      router.replace("/");
      return;
    }

    if (!isCompleted) {
      router.replace("/career-memory");
    }
  }, [loading, user, isCompleted, router]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f6fbff]">
        <p className="font-bold text-blue-600">
          Loading Career Élan...
        </p>
      </main>
    );
  }

  if (!user || !isCompleted) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f6fbff]">
        <p className="font-bold text-blue-600">
          Redirecting to Career Memory...
        </p>
      </main>
    );
  }

  return <>{children}</>;
}
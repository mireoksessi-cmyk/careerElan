"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

interface HeaderProps {
  title: string;
  subtitle: string;
}

export default function Header({
  title,
  subtitle,
}: HeaderProps) {

  const [name, setName] = useState("Career Élan User");

useEffect(() => {
  loadProfile();
}, []);

async function loadProfile() {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return;

  const { data } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();

  if (data?.full_name) {
    setName(data.full_name);
  }
}

  return (
    <header className="flex items-center justify-between px-8 py-6">

      <div>

        <h1 className="text-3xl font-extrabold">
          {title}
        </h1>

        <p className="mt-1 text-sm text-black">
          {subtitle}
        </p>

      </div>

      <div className="flex items-center gap-4">

        <button className="rounded-full bg-white p-3 shadow-sm">
          🔔
        </button>

        <button className="rounded-full bg-white p-3 shadow-sm">
          💬
        </button>

        <div className="flex items-center gap-3 rounded-xl bg-white px-4 py-2 shadow-sm">

         <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 font-bold text-white">
  {name.charAt(0).toUpperCase()}
</div>

          <div>

            <p className="font-bold">
  {name}
</p>

<p className="text-xs text-black">
  Career Élan User
</p>

          </div>

        </div>

      </div>

    </header>
  );
}
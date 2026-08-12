"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/job-layout/Sidebar";
import Header from "@/components/job-layout/Header";
import { useLogin } from "@/lib/auth/LoginManager";
import CareerElanFooter from "@/components/marketing/CareerElanFooter";

/*
  Career Elan only operates in Canada, so Country is fixed - not a free-form
  choice - and Timezone is restricted to real Canadian IANA zones rather
  than forced to a single one (Canada spans 6 time zones).
*/
const FIXED_COUNTRY = "Canada";

const CANADIAN_TIMEZONES = [
  { value: "America/St_Johns", label: "Newfoundland Time (St. John's)" },
  { value: "America/Halifax", label: "Atlantic Time (Halifax)" },
  { value: "America/Toronto", label: "Eastern Time (Toronto)" },
  { value: "America/Winnipeg", label: "Central Time (Winnipeg)" },
  { value: "America/Regina", label: "Central Time - no DST (Regina)" },
  { value: "America/Edmonton", label: "Mountain Time (Edmonton)" },
  { value: "America/Vancouver", label: "Pacific Time (Vancouver)" },
] as const;

const DEFAULT_CANADIAN_TIMEZONE = "America/Toronto";

function isCanadianTimezone(value: string): boolean {
  return CANADIAN_TIMEZONES.some((zone) => zone.value === value);
}

function detectDefaultTimezone(): string {
  try {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isCanadianTimezone(detected)
      ? detected
      : DEFAULT_CANADIAN_TIMEZONE;
  } catch {
    return DEFAULT_CANADIAN_TIMEZONE;
  }
}

export default function SettingsPage() {
 const { user, loading } = useLogin();

  const router = useRouter();

  const [pageLoading, setPageLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  const [userId, setUserId] = useState("");
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [deletingAccount, setDeletingAccount] = useState(false);

  const [profile, setProfile] = useState({
    full_name: "",
    login_id: "",
    email: "",
    phone: "",
    country: "",
    timezone: "",
    email_notifications: true,
    marketing_notifications: false,
  });

  useEffect(() => {
    if (!loading) {
      loadProfile();
    }
  }, [loading, user]);

  async function loadProfile() {
    if (loading) return;

    if (!user) {
      router.push("/");
      return;
    }

    try {
      setPageLoading(true);

      setUserId(user.id);

      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

      console.log("user.id =", user.id);
      console.log("data =", data);
      console.log("error =", error);

      if (error) {
        console.error("Profile Error:", error);
        alert(error.message);
        return;
      }

      if (data) {
        /*
          Preserve an already-valid stored Canadian timezone as-is; only
          fall back to browser-detection (then America/Toronto) when the
          stored value is empty or not a real Canadian zone (e.g. a legacy
          non-Canadian value from before this restriction existed).
        */
        const storedTimezone = data.timezone ?? "";

        setProfile({
          full_name: data.full_name ?? "",
          login_id: data.login_id ?? "",
          email: data.email ?? "",
          phone: data.phone ?? "",
          country: FIXED_COUNTRY,
          timezone: isCanadianTimezone(storedTimezone)
            ? storedTimezone
            : detectDefaultTimezone(),
          email_notifications: data.email_notifications ?? true,
          marketing_notifications: data.marketing_notifications ?? false,
        });
      }
    } catch (err) {
      console.error("Unexpected Error:", err);
      alert("Failed to load profile.");
    } finally {
      setPageLoading(false);
    }
  }

  async function saveProfile() {
    setSaving(true);

    await supabase
      .from("profiles")
      .update({
  full_name: profile.full_name,
  phone: profile.phone,
  country: FIXED_COUNTRY,
  timezone: isCanadianTimezone(profile.timezone)
    ? profile.timezone
    : DEFAULT_CANADIAN_TIMEZONE,

  email_notifications:
    profile.email_notifications,

  marketing_notifications:
    profile.marketing_notifications,
})
      .eq("id", userId);

    alert("Profile updated!");

    setSaving(false);
  }

async function changePassword() {

  if (!password) {
    alert("Enter a new password.");
    return;
  }

  if (password.length < 8) {
    alert("Password must be at least 8 characters.");
    return;
  }

  if (password !== confirmPassword) {
    alert("Passwords do not match.");
    return;
  }

  setChangingPassword(true);

  const { error } = await supabase.auth.updateUser({
    password,
  });

  if (error) {
    alert(error.message);
  } else {
    alert("Password updated successfully.");
    setPassword("");
    setConfirmPassword("");
  }

  setChangingPassword(false);
}

async function logout() {
  const ok = confirm("Are you sure you want to log out?");

  if (!ok) return;

  await supabase.auth.signOut();

  router.push("/");
}

async function deleteAccount() {
  if (!deletePassword) {
    alert("Please enter your password to confirm.");
    return;
  }

  setDeletingAccount(true);

  try {
    const res = await fetch(
      "/api/delete-account",
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
        },
        body: JSON.stringify({
          password: deletePassword,
        }),
      }
    );

    const data = await res.json();

    if (!data.success) {
      /*
        data.error is always the safe, generic message the server
        route builds itself - the server never forwards a raw Supabase
        error or stack trace in this response.
      */
      alert(
        data.error ||
          "We couldn't delete your account. Please try again."
      );
      return;
    }

    setShowDeleteModal(false);
    setDeleteText("");
    setDeletePassword("");

    await supabase.auth.signOut();

    router.push("/");
  } catch (error) {
    console.error("DELETE ACCOUNT ERROR =", error);
    alert("We couldn't delete your account. Please try again.");
  } finally {
    setDeletingAccount(false);
  }
}

  if (loading) {
    return (
      <main className="min-h-screen bg-[#f6fbff] flex items-center justify-center">
        <p className="text-lg font-semibold">Loading...</p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col bg-[#f6fbff]">
      <div className="flex flex-1">

        <Sidebar active="Settings" />

        <section className="flex-1 p-8">

          <Header
            title="Settings"
            subtitle="Manage your profile and account."
          />

          <div className="max-w-4xl">

            <div className="rounded-3xl bg-white p-8 shadow-sm border border-blue-100">

              <div className="mb-8 flex justify-center">

                <div className="flex h-28 w-28 items-center justify-center rounded-full bg-blue-600 text-5xl font-bold text-white">

                  {profile.full_name
                    ? profile.full_name.charAt(0).toUpperCase()
                    : "C"}

                </div>

              </div>

              <div className="space-y-6">

                <div>

                  <label className="font-semibold">
                    Full Name
                  </label>

                  <input
                    className="mt-2 w-full rounded-xl border p-3"
                    value={profile.full_name}
                    onChange={(e) =>
                      setProfile({
                        ...profile,
                        full_name: e.target.value,
                      })
                    }
                  />

                </div>

                <div>

                  <label className="font-semibold">
                    Login ID
                  </label>

                  <input
                    disabled
                    className="mt-2 w-full rounded-xl border bg-gray-100 p-3"
                    value={profile.login_id}
                  />

                </div>

                <div>

                  <label className="font-semibold">
                    Email
                  </label>

                  <input
                    disabled
                    className="mt-2 w-full rounded-xl border bg-gray-100 p-3"
                    value={profile.email}
                  />

                </div>

                <div>

                  <label className="font-semibold">
                    Phone
                  </label>

                  <input
                    className="mt-2 w-full rounded-xl border p-3"
                    value={profile.phone}
                    onChange={(e) =>
                      setProfile({
                        ...profile,
                        phone: e.target.value,
                      })
                    }
                  />

                </div>

                <div className="grid grid-cols-2 gap-6">

                  <div>

                    <label className="font-semibold">
                      Country
                    </label>

                    <input
                      disabled
                      className="mt-2 w-full rounded-xl border bg-gray-100 p-3"
                      value={FIXED_COUNTRY}
                      title="Career Élan currently operates in Canada only."
                    />

                  </div>

                  <div>

                    <label className="font-semibold">
                      Time Zone
                    </label>

                    <select
                      className="mt-2 w-full rounded-xl border p-3"
                      value={profile.timezone}
                      onChange={(e) =>
                        setProfile({
                          ...profile,
                          timezone: e.target.value,
                        })
                      }
                    >
                      {CANADIAN_TIMEZONES.map((zone) => (
                        <option key={zone.value} value={zone.value}>
                          {zone.label}
                        </option>
                      ))}
                    </select>

                  </div>

                </div>

                <button
                  onClick={saveProfile}
                  disabled={saving}
                  className="rounded-xl bg-blue-600 px-8 py-3 font-bold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save Changes"}
                </button>
                   
                <div className="mt-12 border-t pt-10">

  <h2 className="text-2xl font-bold">
    Change Password
  </h2>

  <p className="mt-1 text-sm text-gray-500">
    Update your account password.
  </p>

  <div className="mt-6 space-y-5">

    <div>

      <label className="font-semibold">
        New Password
      </label>

      <input
        type="password"
        value={password}
        onChange={(e) =>
          setPassword(e.target.value)
        }
        className="mt-2 w-full rounded-xl border p-3"
      />

    </div>

    <div>

      <label className="font-semibold">
        Confirm Password
      </label>

      <input
        type="password"
        value={confirmPassword}
        onChange={(e) =>
          setConfirmPassword(e.target.value)
        }
        className="mt-2 w-full rounded-xl border p-3"
      />

    </div>

    <button
      onClick={changePassword}
      disabled={changingPassword}
      className="rounded-xl bg-red-600 px-8 py-3 font-bold text-white hover:bg-red-700"
    >
      {changingPassword
        ? "Updating..."
        : "Change Password"}
    </button>

  </div>

</div>

<div className="mt-12 border-t pt-10">

  <h2 className="text-2xl font-bold">
    Notifications
  </h2>

  <p className="mt-1 text-sm text-gray-500">
    Choose which emails you want to receive.
  </p>

  <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
    These preferences are saved, but Career Élan doesn&apos;t send
    automated emails yet - turning a toggle on will not cause you to
    receive anything right now.
  </p>

  <div className="mt-6 space-y-6">

    <label className="flex items-center justify-between opacity-60">

      <div>

        <div className="flex items-center gap-2">
          <p className="font-semibold">
            Email Notifications
          </p>

          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-500">
            Coming soon
          </span>
        </div>

        <p className="text-sm text-gray-500">
          Receive important account updates.
        </p>

      </div>

      <input
        type="checkbox"
        disabled
        checked={profile.email_notifications}
        onChange={(e) =>
          setProfile({
            ...profile,
            email_notifications: e.target.checked,
          })
        }
        className="h-5 w-5 cursor-not-allowed"
      />

    </label>

    <label className="flex items-center justify-between opacity-60">

      <div>

        <div className="flex items-center gap-2">
          <p className="font-semibold">
            Marketing Emails
          </p>

          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-500">
            Coming soon
          </span>
        </div>

        <p className="text-sm text-gray-500">
          Receive product updates and feature announcements.
        </p>

      </div>

      <input
  type="checkbox"
  disabled
  checked={profile.marketing_notifications}
  onChange={(e) =>
    setProfile({
      ...profile,
      marketing_notifications: e.target.checked,
    })
  }
  className="h-5 w-5 cursor-not-allowed"
/>

    </label>

  </div>

</div>

<div className="mt-12 border-t pt-10">

  <h2 className="text-2xl font-bold">
    Account
  </h2>

  <p className="mt-1 text-sm text-gray-500">
    Manage your account session.
  </p>

  <button
    onClick={logout}
    className="mt-6 rounded-xl bg-gray-900 px-8 py-3 font-bold text-white transition hover:bg-black"
  >
    Log Out
  </button>

  <div className="mt-8 border-t pt-6">

    <p className="text-xs text-gray-400">
      Permanently remove your account and all associated data.
    </p>

    <button
      onClick={() => setShowDeleteModal(true)}
      className="mt-3 text-sm font-semibold text-red-600 transition hover:text-red-700"
    >
      Delete Account
    </button>

  </div>

</div>

              </div>

            </div>

          </div>

        </section>

      </div>

      <CareerElanFooter />

      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">

          <div className="w-full max-w-md rounded-3xl bg-white p-8 shadow-xl">

            <h2 className="text-2xl font-bold">
              Delete Account
            </h2>

            <p className="mt-3 text-sm text-gray-600">
              This action is permanent and cannot be undone.
            </p>

            <p className="mt-2 text-sm text-gray-600">
              Type <span className="font-bold">DELETE</span> to continue.
            </p>

            <input
              value={deleteText}
              onChange={(e) => setDeleteText(e.target.value)}
              className="mt-5 w-full rounded-xl border p-3"
              placeholder="Type DELETE"
            />

            <p className="mt-4 text-sm text-gray-600">
              Enter your password to confirm.
            </p>

            <input
              type="password"
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
              className="mt-2 w-full rounded-xl border p-3"
              placeholder="Password"
            />

            <div className="mt-8 flex justify-end gap-3">

              <button
                onClick={() => {
                  setShowDeleteModal(false);
                  setDeleteText("");
                  setDeletePassword("");
                }}
                className="rounded-xl border px-5 py-2"
              >
                Cancel
              </button>

              <button
                disabled={
                  deleteText !== "DELETE" ||
                  !deletePassword ||
                  deletingAccount
                }
                onClick={deleteAccount}
                className="rounded-xl bg-red-600 px-5 py-2 font-bold text-white disabled:opacity-40"
              >
                {deletingAccount
                  ? "Deleting…"
                  : "Delete Account"}
              </button>

            </div>

          </div>

        </div>
      )}

    </main>
  );
}
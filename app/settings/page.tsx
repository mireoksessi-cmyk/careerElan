"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/job-layout/Sidebar";
import Header from "@/components/job-layout/Header";
import { useLogin } from "@/lib/auth/LoginManager";
import CareerElanFooter from "@/components/marketing/CareerElanFooter";
import { useModalFocusTrap } from "@/lib/hooks/useModalFocusTrap";
import { useToast } from "@/components/ui/ToastProvider";
import { useConfirm } from "@/components/ui/ConfirmDialogProvider";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SectionHeading } from "@/components/ui/SectionHeading";

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

/*
  Phase 2F design-system unification. Settings previously had no
  consistent border/focus style on its inputs at all (audit found it
  was the only page with a bare "rounded-xl border p-3" and no focus
  ring) - this is the shared input shape used elsewhere in the new
  design system's default (border-slate-300, blue focus ring).
*/
const INPUT_CLASS =
  "mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
const DISABLED_INPUT_CLASS = `${INPUT_CLASS} bg-slate-100 text-slate-500`;

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
  const toast = useToast();
  const confirm = useConfirm();

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

  const deleteModalPanelRef = useRef<HTMLDivElement | null>(null);
  const deleteModalCloseRef = useRef<HTMLButtonElement | null>(null);
  useModalFocusTrap(showDeleteModal, deleteModalPanelRef, deleteModalCloseRef, () => {
    setShowDeleteModal(false);
    setDeleteText("");
    setDeletePassword("");
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
        toast.error(error.message);
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
      toast.error("Failed to load profile.");
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

    toast.success("Profile updated!");

    setSaving(false);
  }

async function changePassword() {

  if (!password) {
    toast.warning("Enter a new password.");
    return;
  }

  if (password.length < 8) {
    toast.warning("Password must be at least 8 characters.");
    return;
  }

  if (password !== confirmPassword) {
    toast.warning("Passwords do not match.");
    return;
  }

  setChangingPassword(true);

  const { error } = await supabase.auth.updateUser({
    password,
  });

  if (error) {
    toast.error(error.message);
  } else {
    toast.success("Password updated successfully.");
    setPassword("");
    setConfirmPassword("");
  }

  setChangingPassword(false);
}

async function logout() {
  const ok = await confirm({
    title: "Log out?",
    description: "You'll need to sign in again to access your account.",
    confirmLabel: "Log Out",
  });

  if (!ok) return;

  await supabase.auth.signOut();

  router.push("/");
}

async function deleteAccount() {
  if (!deletePassword) {
    toast.warning("Please enter your password to confirm.");
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
      toast.error(
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
    toast.error("We couldn't delete your account. Please try again.");
  } finally {
    setDeletingAccount(false);
  }
}

  if (loading) {
    return (
      <main className="min-h-screen bg-[#f6fbff] flex items-center justify-center">
        <p role="status" aria-live="polite" className="text-lg font-semibold">Loading...</p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col bg-[#f6fbff]">
      <div className="flex flex-1 flex-col md:flex-row">

        <Sidebar active="Settings" />

        <section className="flex-1 p-8">

          <Header
            title="Settings"
            subtitle="Manage your profile and account."
          />

          <div className="max-w-4xl">

            <Card padding="lg">

              <div className="mb-8 flex justify-center">

                <div className="flex h-28 w-28 items-center justify-center rounded-full bg-blue-600 text-5xl font-bold text-white">

                  {profile.full_name
                    ? profile.full_name.charAt(0).toUpperCase()
                    : "C"}

                </div>

              </div>

              <div className="space-y-6">

                <div>

                  <label htmlFor="settings-full-name" className="font-semibold">
                    Full Name
                  </label>

                  <input
                    id="settings-full-name"
                    className={INPUT_CLASS}
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

                  <label htmlFor="settings-login-id" className="font-semibold">
                    Login ID
                  </label>

                  <input
                    id="settings-login-id"
                    disabled
                    className={DISABLED_INPUT_CLASS}
                    value={profile.login_id}
                  />

                </div>

                <div>

                  <label htmlFor="settings-email" className="font-semibold">
                    Email
                  </label>

                  <input
                    id="settings-email"
                    disabled
                    className={DISABLED_INPUT_CLASS}
                    value={profile.email}
                  />

                </div>

                <div>

                  <label htmlFor="settings-phone" className="font-semibold">
                    Phone
                  </label>

                  <input
                    id="settings-phone"
                    className={INPUT_CLASS}
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

                    <label htmlFor="settings-country" className="font-semibold">
                      Country
                    </label>

                    <input
                      id="settings-country"
                      disabled
                      className={DISABLED_INPUT_CLASS}
                      value={FIXED_COUNTRY}
                      title="Career Élan currently operates in Canada only."
                    />

                  </div>

                  <div>

                    <label htmlFor="settings-timezone" className="font-semibold">
                      Time Zone
                    </label>

                    <select
                      id="settings-timezone"
                      className={INPUT_CLASS}
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

                <Button onClick={saveProfile} disabled={saving} size="lg">
                  {saving ? "Saving..." : "Save Changes"}
                </Button>

                <div className="mt-12 border-t pt-10">

  <SectionHeading subtitle="Update your account password.">
    Change Password
  </SectionHeading>

  <div className="mt-6 space-y-5">

    <div>

      <label htmlFor="settings-new-password" className="font-semibold">
        New Password
      </label>

      <input
        id="settings-new-password"
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(e) =>
          setPassword(e.target.value)
        }
        className={INPUT_CLASS}
      />

    </div>

    <div>

      <label htmlFor="settings-confirm-password" className="font-semibold">
        Confirm Password
      </label>

      <input
        id="settings-confirm-password"
        type="password"
        autoComplete="new-password"
        value={confirmPassword}
        onChange={(e) =>
          setConfirmPassword(e.target.value)
        }
        className={INPUT_CLASS}
      />

    </div>

    <Button onClick={changePassword} disabled={changingPassword} size="lg">
      {changingPassword
        ? "Updating..."
        : "Change Password"}
    </Button>

  </div>

</div>

<div className="mt-12 border-t pt-10">

  <SectionHeading subtitle="Choose which emails you want to receive.">
    Notifications
  </SectionHeading>

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

          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">
            Coming soon
          </span>
        </div>

        <p className="text-sm text-slate-500">
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

          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">
            Coming soon
          </span>
        </div>

        <p className="text-sm text-slate-500">
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

  <SectionHeading subtitle="Manage your account session.">
    Account
  </SectionHeading>

  <Button onClick={logout} variant="secondary" size="lg" className="mt-6">
    Log Out
  </Button>

  <div className="mt-8 border-t pt-6">

    <p className="text-xs text-slate-400">
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

            </Card>

          </div>

        </section>

      </div>

      <CareerElanFooter />

      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">

          <div
            ref={deleteModalPanelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-account-modal-title"
            className="w-full max-w-md rounded-3xl bg-white p-8 shadow-xl"
          >

            <h2 id="delete-account-modal-title" className="text-2xl font-bold">
              Delete Account
            </h2>

            <p className="mt-3 text-sm text-slate-600">
              This action is permanent and cannot be undone.
            </p>

            <label htmlFor="delete-account-confirm-text" className="mt-2 block text-sm text-slate-600">
              Type <span className="font-bold">DELETE</span> to continue.
            </label>

            <input
              id="delete-account-confirm-text"
              value={deleteText}
              onChange={(e) => setDeleteText(e.target.value)}
              className={INPUT_CLASS}
              placeholder="Type DELETE"
            />

            <label htmlFor="delete-account-password" className="mt-4 block text-sm text-slate-600">
              Enter your password to confirm.
            </label>

            <input
              id="delete-account-password"
              type="password"
              autoComplete="current-password"
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
              className={INPUT_CLASS}
              placeholder="Password"
            />

            <div className="mt-8 flex justify-end gap-3">

              <Button
                ref={deleteModalCloseRef}
                onClick={() => {
                  setShowDeleteModal(false);
                  setDeleteText("");
                  setDeletePassword("");
                }}
                variant="secondary"
              >
                Cancel
              </Button>

              <Button
                disabled={
                  deleteText !== "DELETE" ||
                  !deletePassword ||
                  deletingAccount
                }
                onClick={deleteAccount}
                variant="danger"
              >
                {deletingAccount
                  ? "Deleting…"
                  : "Delete Account"}
              </Button>

            </div>

          </div>

        </div>
      )}

    </main>
  );
}
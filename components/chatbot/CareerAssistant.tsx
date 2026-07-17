"use client";

import { useState } from "react";
import CareerAssistantButton from "./CareerAssistantButton";

type HelpTopic = {
  id: string;
  title: string;
  description: string;
  icon: string;
  iconClassName: string;
};

const helpTopics: HelpTopic[] = [
  {
    id: "career-memory",
    title: "Career Memory",
    description:
      "Profile, resume selection, and Career Memory setup.",
    icon: "🧠",
    iconClassName:
      "bg-blue-50 text-blue-600",
  },
  {
    id: "application-package",
    title: "Application Package",
    description:
      "Generate, review, save, and download your package.",
    icon: "📦",
    iconClassName:
      "bg-purple-50 text-purple-600",
  },
  {
    id: "find-jobs",
    title: "Find Jobs",
    description:
      "Job search and personalized recommendations.",
    icon: "🔍",
    iconClassName:
      "bg-emerald-50 text-emerald-600",
  },
  {
    id: "paste-job",
    title: "Paste Job",
    description:
      "Analyze a job URL, description, or uploaded file.",
    icon: "📋",
    iconClassName:
      "bg-orange-50 text-orange-600",
  },
  {
    id: "job-tracker",
    title: "Job Tracker",
    description:
      "Applications, statuses, interviews, and notes.",
    icon: "💼",
    iconClassName:
      "bg-sky-50 text-sky-600",
  },
  {
    id: "analytics",
    title: "Analytics",
    description:
      "Application performance and career insights.",
    icon: "📊",
    iconClassName:
      "bg-cyan-50 text-cyan-600",
  },
  {
    id: "resume-cover-letter",
    title: "Resume & Cover Letter",
    description:
      "Upload, select, preview, edit, or delete documents.",
    icon: "📄",
    iconClassName:
      "bg-indigo-50 text-indigo-600",
  },
  {
    id: "account-settings",
    title: "Account & Settings",
    description:
      "Profile, login, password, and account settings.",
    icon: "⚙️",
    iconClassName:
      "bg-slate-100 text-slate-600",
  },
  {
    id: "billing-plan",
    title: "Billing & Plan",
    description:
      "Free Beta, Pro plan, usage limits, and billing.",
    icon: "💳",
    iconClassName:
      "bg-amber-50 text-amber-600",
  },
  {
    id: "contact-support",
    title: "Contact Support",
    description:
      "Contact Career Élan for additional assistance.",
    icon: "✉️",
    iconClassName:
      "bg-rose-50 text-rose-600",
  },
];

export default function CareerAssistant() {
  const [open, setOpen] =
    useState(false);

  const [message, setMessage] =
    useState("");

  const [
    selectedTopic,
    setSelectedTopic,
  ] = useState<HelpTopic | null>(
    null
  );

  function handleSend() {
    const trimmedMessage =
      message.trim();

    if (!trimmedMessage) return;

    console.log(
      "Career Assistant message:",
      trimmedMessage
    );

    setMessage("");
  }

  function closeAssistant() {
    setOpen(false);
    setSelectedTopic(null);
  }

  return (
    <>
      <CareerAssistantButton
        onClick={() =>
          setOpen((previous) =>
            !previous
          )
        }
      />

      {open && (
        <section className="fixed bottom-24 right-6 z-[100] flex h-[720px] w-[440px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-[30px] border border-blue-100 bg-white shadow-[0_30px_80px_rgba(15,23,42,0.24)]">
          {/* Header */}
          <header className="flex shrink-0 items-center justify-between bg-gradient-to-r from-[#082a78] to-[#06215d] px-6 py-5 text-white">
            <div className="flex min-w-0 items-center gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-4 border-white/20 bg-blue-500 text-2xl shadow-inner">
                🤖
              </div>

              <div className="min-w-0">
                <h2 className="truncate text-xl font-extrabold">
                  Career Élan Assistant
                </h2>

                <div className="mt-1 flex items-center gap-2 text-sm text-blue-100">
                  <span className="h-2.5 w-2.5 rounded-full bg-green-400" />

                  <span>Online</span>
                </div>
              </div>
            </div>

            <div className="ml-3 flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() =>
                  setOpen(false)
                }
                aria-label="Minimize assistant"
                className="flex h-10 w-10 items-center justify-center rounded-full text-2xl text-white/80 transition hover:bg-white/10 hover:text-white"
              >
                −
              </button>

              <button
                type="button"
                onClick={
                  closeAssistant
                }
                aria-label="Close assistant"
                className="flex h-10 w-10 items-center justify-center rounded-full text-3xl text-white/80 transition hover:bg-white/10 hover:text-white"
              >
                ×
              </button>
            </div>
          </header>

          {/* Main content */}
          <div className="flex-1 overflow-y-auto bg-[#f8fbff] px-5 py-5">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-indigo-700 text-lg text-white">
                🤖
              </div>

              <div>
                <div className="max-w-[290px] rounded-3xl rounded-tl-md bg-white px-5 py-4 text-sm leading-6 text-slate-800 shadow-sm">
                  Hi! 👋
                  <br />
                  How can I help you
                  today?
                </div>

                <p className="mt-2 text-xs text-slate-400">
                  Career Élan Support
                </p>
              </div>
            </div>

            {!selectedTopic ? (
              <>
                <div className="mt-6 flex items-center justify-between">
                  <div>
                    <h3 className="font-extrabold text-slate-900">
                      Help Topics
                    </h3>

                    <p className="mt-1 text-xs text-slate-500">
                      Choose a topic to
                      continue.
                    </p>
                  </div>

                  <span className="rounded-full bg-blue-50 px-3 py-1 text-[11px] font-bold text-blue-600">
                    Support
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  {helpTopics.map(
                    (topic) => (
                      <button
                        key={topic.id}
                        type="button"
                        onClick={() =>
                          setSelectedTopic(
                            topic
                          )
                        }
                        className="group min-h-[150px] rounded-2xl border border-blue-100 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div
                            className={`flex h-11 w-11 items-center justify-center rounded-xl text-xl ${topic.iconClassName}`}
                          >
                            {topic.icon}
                          </div>

                          <span className="text-xl text-slate-300 transition group-hover:translate-x-1 group-hover:text-blue-600">
                            ›
                          </span>
                        </div>

                        <h4 className="mt-4 text-sm font-extrabold text-slate-900">
                          {topic.title}
                        </h4>

                        <p className="mt-2 text-xs leading-5 text-slate-500">
                          {
                            topic.description
                          }
                        </p>
                      </button>
                    )
                  )}
                </div>
              </>
            ) : (
              <div className="mt-6">
                <button
                  type="button"
                  onClick={() =>
                    setSelectedTopic(
                      null
                    )
                  }
                  className="inline-flex items-center gap-2 text-sm font-bold text-blue-600 hover:text-blue-700"
                >
                  ← Back to all topics
                </button>

                <div className="mt-4 rounded-3xl border border-blue-100 bg-white p-5 shadow-sm">
                  <div className="flex items-start gap-4">
                    <div
                      className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-2xl ${selectedTopic.iconClassName}`}
                    >
                      {
                        selectedTopic.icon
                      }
                    </div>

                    <div>
                      <h3 className="text-lg font-extrabold text-slate-900">
                        {
                          selectedTopic.title
                        }
                      </h3>

                      <p className="mt-2 text-sm leading-6 text-slate-500">
                        {
                          selectedTopic.description
                        }
                      </p>
                    </div>
                  </div>

                  {/* 세부 문의 카드를 나중에 이곳에 추가 */}
                  <div className="mt-5 min-h-[260px] rounded-2xl border border-dashed border-slate-200 bg-slate-50" />
                </div>
              </div>
            )}
          </div>

          {/* Message input */}
          <footer className="shrink-0 border-t border-slate-100 bg-white px-5 pb-5 pt-4">
            <div className="flex items-center gap-3 rounded-2xl border border-blue-100 bg-white px-4 py-3 shadow-sm focus-within:border-blue-400 focus-within:ring-4 focus-within:ring-blue-100">
              <input
                type="text"
                value={message}
                onChange={(event) =>
                  setMessage(
                    event.target.value
                  )
                }
                onKeyDown={(
                  event
                ) => {
                  if (
                    event.key ===
                    "Enter"
                  ) {
                    handleSend();
                  }
                }}
                placeholder="Type your message..."
                className="min-w-0 flex-1 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
              />

              <button
                type="button"
                onClick={handleSend}
                aria-label="Send message"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-lg text-white transition hover:bg-blue-700"
              >
                ➤
              </button>
            </div>

            <p className="mt-3 text-center text-xs font-medium text-slate-400">
              We&apos;re here to help
              you succeed. 💙
            </p>
          </footer>
        </section>
      )}
    </>
  );
}
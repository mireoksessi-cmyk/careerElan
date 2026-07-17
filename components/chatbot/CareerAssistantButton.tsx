"use client";

type Props = {
  onClick: () => void;
};

export default function CareerAssistantButton({
  onClick,
}: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Open Career Élan Assistant"
      className="fixed bottom-6 right-6 z-[90] flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-indigo-700 text-3xl text-white shadow-2xl transition hover:scale-105 hover:shadow-blue-300/50"
    >
      🤖
    </button>
  );
}
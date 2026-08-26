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
      aria-label="Open Career Élan Help"
      className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-indigo-700 text-2xl text-white shadow-2xl transition hover:scale-105 hover:shadow-blue-300/50 sm:bottom-6 sm:right-6 sm:h-16 sm:w-16 sm:text-3xl"
    >
      🤖
    </button>
  );
}
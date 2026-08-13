import type { HTMLAttributes } from "react";

type CardPadding = "sm" | "md" | "lg";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: CardPadding;
}

/*
  Phase 2F design-system unification. The audit found the same "white
  content panel" role expressed with 3 different radii, 3 different
  border colors, and 3 different shadow levels across pages with no
  rule tying the variant to the panel's actual role - this canonical
  shape (rounded-2xl / border-blue-100 / shadow-sm) was the majority
  pattern already in use (Dashboard, Career Memory, Find Jobs), so it
  becomes the shared default rather than inventing a new look.
*/
const PADDING_CLASSES: Record<CardPadding, string> = {
  sm: "p-5",
  md: "p-6",
  lg: "p-8",
};

export function Card({ padding = "md", className = "", ...props }: CardProps) {
  return (
    <div
      className={`rounded-2xl border border-blue-100 bg-white shadow-sm ${PADDING_CLASSES[padding]} ${className}`}
      {...props}
    />
  );
}

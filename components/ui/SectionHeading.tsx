import type { HTMLAttributes, ReactNode } from "react";

interface SectionHeadingProps extends HTMLAttributes<HTMLHeadingElement> {
  subtitle?: ReactNode;
}

/*
  Phase 2F design-system unification. The audit found 9+ distinct
  class combinations doing the same job (a section title inside an
  authenticated page, e.g. Settings' "Change Password" / "Account").
  This is the single shared shape going forward; page titles (h1) are
  intentionally out of scope here - those already have a working
  shared component (components/job-layout/Header.tsx) on the pages
  that use it.
*/
export function SectionHeading({ children, subtitle, className = "", ...props }: SectionHeadingProps) {
  return (
    <div className="mb-4">
      <h2 className={`text-xl font-bold text-slate-900 ${className}`} {...props}>
        {children}
      </h2>
      {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
    </div>
  );
}

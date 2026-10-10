import type { HTMLAttributes } from "react";

/** Rounded card container. */
export function Card({ className = "", ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-panel border border-line bg-surface p-5 shadow-panel sm:p-6 ${className}`}
      {...rest}
    />
  );
}

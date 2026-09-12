import type { ButtonHTMLAttributes } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

/** Primary action button (also used for destructive confirm with `variant`). */
export function Button({ className = "", variant, ...rest }: ButtonProps & { variant?: "primary" | "danger" }) {
  const base =
    "rounded px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50";
  const style =
    variant === "danger"
      ? "bg-red-600 text-white hover:bg-red-700"
      : "bg-slate-900 text-white hover:bg-slate-700";
  return <button type="button" className={`${base} ${style} ${className}`} {...rest} />;
}

import type { ButtonHTMLAttributes } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

/** Primary action button (also used for destructive confirm with `variant`). */
export function Button({ className = "", variant, ...rest }: ButtonProps & { variant?: "primary" | "danger" }) {
  const base =
    "rounded-control px-4 py-2.5 text-sm font-semibold transition duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100";
  const style =
    variant === "danger"
      ? "bg-danger-strong text-canvas hover:bg-danger"
      : "bg-accent-strong text-canvas shadow-sm hover:bg-accent hover:shadow-glow";
  return <button type="button" className={`${base} ${style} ${className}`} {...rest} />;
}

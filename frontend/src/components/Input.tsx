import type { InputHTMLAttributes } from "react";

type InputProps = InputHTMLAttributes<HTMLInputElement>;

/** Styled text input; `aria-invalid` gets a red ring for field errors. */
export function Input({ className = "", ...rest }: InputProps) {
  const invalid = rest["aria-invalid"] === true || rest["aria-invalid"] === "true";
  return (
    <input
      className={`w-full rounded-control border bg-canvas px-3 py-2.5 text-sm text-ink placeholder:text-subtle transition duration-150 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-50 ${
        invalid ? "border-danger text-danger" : "border-line-strong hover:border-accent/40"
      } ${className}`}
      {...rest}
    />
  );
}

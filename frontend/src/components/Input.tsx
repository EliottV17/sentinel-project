import type { InputHTMLAttributes } from "react";

type InputProps = InputHTMLAttributes<HTMLInputElement>;

/** Styled text input; `aria-invalid` gets a red ring for field errors. */
export function Input({ className = "", ...rest }: InputProps) {
  const invalid = rest["aria-invalid"] === true || rest["aria-invalid"] === "true";
  return (
    <input
      className={`rounded border px-3 py-2 text-sm ${
        invalid ? "border-red-500" : "border-slate-300"
      } ${className}`}
      {...rest}
    />
  );
}

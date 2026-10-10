import { useRef, useState, type ReactNode } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Link, useNavigate } from "react-router-dom";
import { ApiError } from "../../app/api/client";
import { registerUser } from "../../app/api/endpoints";
import { useAuth } from "../../app/auth/AuthProvider";
import { SentinelBrand } from "../../components/SentinelBrand";

const registerSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  last_name: z.string().trim().min(1, "Last name is required"),
  username: z.string().regex(/^[A-Za-z0-9]{3,20}$/, "Use 3 to 20 letters or numbers."),
  email: z.string().email("Enter a valid email address."),
  password: z.string()
    .min(8, "Use at least 8 characters.")
    .regex(/[A-Za-z]/, "Include at least one letter and one number.")
    .regex(/[0-9]/, "Include at least one letter and one number."),
  confirmPassword: z.string(),
}).refine((values) => values.password === values.confirmPassword, {
  message: "Passwords must match.",
  path: ["confirmPassword"],
});

type RegisterValues = z.infer<typeof registerSchema>;
type RegisterField = "name" | "last_name" | "username" | "email" | "password" | "confirmPassword";

const fieldMap: Record<string, RegisterField | undefined> = {
  name: "name",
  last_name: "last_name",
  lastname: "last_name",
  username: "username",
  email: "email",
  password: "password",
  confirmPassword: "confirmPassword",
};

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const raw = error.message.toLowerCase();
    if (error.status === 429) return "Too many requests. Please wait a moment before trying again.";
    if (error.status === 400 && raw.includes("email already registered")) return "Email already registered";
    if (error.status === 400 && raw.includes("username already taken")) return "Username already taken";
    if (error.status === 400 || error.status === 422) return "Please review the registration details and try again.";
  }
  return "Unable to create your account right now. Please try again.";
}

function Arrow() {
  return <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="ml-2 size-4"><path d="M3 13 13 3M5 3h8v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function Field({
  id,
  label,
  error,
  children,
}: {
  id: RegisterField;
  label: string;
  error?: string;
  children: (descriptionId: string | undefined) => ReactNode;
}) {
  const errorId = `${id}-error`;
  return (
    <div className="flex min-w-0 flex-col gap-2 text-sm font-medium text-ink">
      <label htmlFor={id}>{label}</label>
      {children(error ? errorId : undefined)}
      {error && <span id={errorId} className="text-xs text-danger">{error}</span>}
    </div>
  );
}

const inputClass = "h-11 w-full rounded-control border border-line-strong bg-canvas px-3 text-sm text-ink outline-none placeholder:text-subtle focus:border-accent focus:ring-2 focus:ring-accent/20 aria-[invalid=true]:border-danger";

export function RegisterPage() {
  const { demoLogin } = useAuth();
  const navigate = useNavigate();
  const [demoSubmitting, setDemoSubmitting] = useState(false);
  const [demoError, setDemoError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterValues>({ resolver: zodResolver(registerSchema) });
  const disabled = isSubmitting || demoSubmitting;

  const onSubmit = handleSubmit(async (values) => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const { name, last_name, username, email, password } = values;
      await registerUser({ name, last_name, username, email, password });
      navigate("/login", { replace: true, state: { accountCreated: true } });
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        const message = error.message.toLowerCase();
        if (message.includes("email already registered")) {
          setError("email", { message: "Email already registered" });
          return;
        }
        if (message.includes("username already taken")) {
          setError("username", { message: "Username already taken" });
          return;
        }
        for (const key of Object.keys(error.fields ?? {})) {
          const field = fieldMap[key];
          if (field && field !== "confirmPassword") {
            setError(field, { message: "Check this value and try again." });
          }
        }
      }
      setError("root", { message: errorMessage(error) });
    } finally {
      busyRef.current = false;
    }
  });

  const onDemo = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setDemoSubmitting(true);
    setDemoError(null);
    try {
      await demoLogin();
      navigate("/", { replace: true });
    } catch {
      setDemoError("Unable to open the demo right now. Please try again.");
    } finally {
      busyRef.current = false;
      setDemoSubmitting(false);
    }
  };

  const onFieldError = (field: RegisterField) => ({
    "aria-invalid": errors[field] !== undefined,
  });

  return (
    <main className="relative flex min-h-screen items-center overflow-hidden px-5 py-10 text-ink sm:px-8">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -left-48 top-1/2 size-[34rem] -translate-y-1/2 rounded-full border border-accent/10" />
        <div className="absolute -left-28 top-1/2 size-[24rem] -translate-y-1/2 rounded-full border border-accent/10" />
        <div className="absolute right-0 top-0 h-px w-2/5 bg-line" />
        <div className="absolute bottom-16 left-0 h-px w-1/4 bg-line" />
      </div>
      <div className="relative mx-auto grid w-full max-w-6xl gap-8 lg:grid-cols-[minmax(0,1fr)_440px] lg:items-center lg:gap-24">
        <section className="hidden lg:block">
          <div className="mb-8 flex items-center gap-5 text-sm text-muted"><SentinelBrand /><span className="border-l border-line pl-5 font-mono text-xs uppercase tracking-[0.18em]">Access portal</span></div>
          <p className="mb-5 max-w-xl font-serif text-5xl font-semibold leading-[1.05] tracking-[-0.07em] text-ink xl:text-6xl">Make every signal<span className="block italic text-accent">visible.</span></p>
          <p className="max-w-md text-base leading-7 text-muted">Create a quiet control room for availability, uptime, and the details that keep your systems dependable.</p>
          <div className="mt-12 flex items-center gap-3 text-xs text-muted"><span className="size-2 rounded-full bg-success" aria-hidden="true" />Monitoring layer operational</div>
        </section>

        <section className="w-full rounded-panel border border-line bg-surface p-6 shadow-panel sm:p-8">
          <div className="mb-8 flex items-center justify-between lg:hidden"><SentinelBrand compact /><span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">Access portal</span></div>
          <div className="mb-7">
            <p className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-accent">Create workspace</p>
            <h1 className="text-3xl font-semibold tracking-tight text-ink">Register for Sentinel</h1>
            <p className="mt-2 text-sm leading-6 text-muted">Set up your observability workspace in a few seconds.</p>
          </div>
          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="name" label="Name" error={errors.name?.message}>{(describedBy) => <input id="name" autoComplete="given-name" placeholder="Alex" {...register("name")} {...onFieldError("name")} aria-describedby={describedBy} className={inputClass} />}</Field>
              <Field id="last_name" label="Last name" error={errors.last_name?.message}>{(describedBy) => <input id="last_name" autoComplete="family-name" placeholder="Morgan" {...register("last_name")} {...onFieldError("last_name")} aria-describedby={describedBy} className={inputClass} />}</Field>
            </div>
            <Field id="username" label="Username" error={errors.username?.message}>{(describedBy) => <input id="username" autoComplete="username" placeholder="alexmorgan" {...register("username")} {...onFieldError("username")} aria-describedby={describedBy} className={inputClass} />}</Field>
            <Field id="email" label="Email" error={errors.email?.message}>{(describedBy) => <input id="email" type="email" autoComplete="email" placeholder="you@example.com" {...register("email")} {...onFieldError("email")} aria-describedby={describedBy} className={inputClass} />}</Field>
            <Field id="password" label="Password" error={errors.password?.message}>{(describedBy) => <div className="relative"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"><rect x="5" y="10" width="14" height="11" rx="2" stroke="currentColor" strokeWidth="1.5" /><path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg><input id="password" type="password" autoComplete="new-password" placeholder="Create a password" {...register("password")} {...onFieldError("password")} aria-describedby={describedBy} className={`${inputClass} pl-10`} /></div>}</Field>
            <Field id="confirmPassword" label="Confirm password" error={errors.confirmPassword?.message}>{(describedBy) => <div className="relative"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"><rect x="5" y="10" width="14" height="11" rx="2" stroke="currentColor" strokeWidth="1.5" /><path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg><input id="confirmPassword" type="password" autoComplete="new-password" placeholder="Repeat your password" {...register("confirmPassword")} {...onFieldError("confirmPassword")} aria-describedby={describedBy} className={`${inputClass} pl-10`} /></div>}</Field>
            {errors.root && <p role="alert" className="text-sm text-danger">{errors.root.message}</p>}
            <button type="submit" disabled={disabled} className="mt-2 flex h-11 w-full items-center justify-center rounded-control bg-accent-strong px-4 text-sm font-semibold text-canvas shadow-sm hover:bg-accent hover:shadow-glow disabled:cursor-not-allowed disabled:opacity-50">{isSubmitting ? "Creating account…" : <>Create account <Arrow /></>}</button>
          </form>
          <div className="my-7 flex items-center gap-3 text-[10px] uppercase tracking-[0.18em] text-muted"><span className="h-px flex-1 bg-line" />Or use demo<span className="h-px flex-1 bg-line" /></div>
          {demoError && <p role="alert" className="mb-3 text-center text-sm text-danger">{demoError}</p>}
          <button type="button" disabled={disabled} onClick={onDemo} className="flex h-11 w-full items-center justify-center rounded-control border border-accent/40 bg-surface px-4 text-sm font-semibold text-accent hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-50">{demoSubmitting ? "Opening demo…" : <>Try the demo <Arrow /></>}</button>
          <p className="mt-7 text-center text-sm text-muted">Already have an account? <Link to="/login" className="font-medium text-accent underline-offset-4 hover:underline">Sign in</Link></p>
          <Link to="/status" className="mt-6 flex w-full items-center justify-center border-t border-line pt-5 text-sm text-muted transition hover:text-accent">System Status <Arrow /></Link>
        </section>
      </div>
    </main>
  );
}

import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ApiError } from "../../app/api/client";
import { useAuth } from "../../app/auth/AuthProvider";
import { SentinelBrand } from "../../components/SentinelBrand";

const demoEmail = import.meta.env.VITE_DEMO_USER_EMAIL || "demo@sentinel.dev";
const demoPassword = import.meta.env.VITE_DEMO_USER_PASSWORD || "DemoPassword123!";

const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

type LoginValues = z.infer<typeof loginSchema>;

export function LoginPage() {
  const { isAuthenticated, login, demoLogin } = useAuth();
  const [demoSubmitting, setDemoSubmitting] = useState(false);
  const [demoError, setDemoError] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const from =
    location.state !== null &&
    typeof location.state === "object" &&
    "from" in location.state &&
    typeof (location.state as { from: unknown }).from === "string"
      ? (location.state as { from: string }).from
      : "/";

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
  });

  const ownsNavigationRef = useRef(false);

  // A successful login owns navigation to the original protected destination.
  useEffect(() => {
    if (isAuthenticated && !ownsNavigationRef.current) {
      navigate("/", { replace: true });
    }
  }, [isAuthenticated, navigate]);

  const onDemoLogin = async () => {
    setDemoSubmitting(true);
    setDemoError(null);
    ownsNavigationRef.current = true;
    try {
      await demoLogin();
      navigate(from, { replace: true });
    } catch (err) {
      setDemoError(
        err instanceof ApiError && err.status === 503
          ? "Demo access is currently unavailable. Please try again later."
          : "Unable to sign in to the demo right now. Please try again.",
      );
    } finally {
      setDemoSubmitting(false);
    }
  };

  const onSubmit = handleSubmit(async (values) => {
    ownsNavigationRef.current = true;
    try {
      await login(values.username, values.password);
      navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError("root", { message: "Invalid credentials or email" });
      } else {
        setError("root", { message: "API unreachable" });
      }
    }
  });

  return (
    <main className="relative flex min-h-screen items-center overflow-hidden px-5 py-8 text-ink sm:px-8 sm:py-12">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -left-56 top-1/2 size-[34rem] -translate-y-1/2 rounded-full border border-accent/10" />
        <div className="absolute -left-36 top-1/2 size-[24rem] -translate-y-1/2 rounded-full border border-accent/10" />
        <div className="absolute right-0 top-0 h-px w-2/5 bg-line" />
        <div className="absolute bottom-12 left-0 h-px w-1/4 bg-line" />
      </div>

      <div className="relative mx-auto grid w-full max-w-6xl gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(24rem,28rem)] lg:items-center lg:gap-16">
        <section className="flex flex-col">
          <div className="mb-8 flex items-center justify-between lg:justify-start lg:gap-5">
            <SentinelBrand />
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted lg:border-l lg:border-line lg:pl-5 lg:text-xs">
              Access portal
            </span>
          </div>
          <p className="mb-4 max-w-xl font-serif text-4xl leading-tight tracking-tight text-ink sm:text-5xl xl:text-6xl">
            Keep every signal
            <span className="block italic text-accent">within sight.</span>
          </p>
          <p className="max-w-lg text-sm leading-7 text-muted sm:text-base">
            A calm control room for availability, uptime, and the details that keep your systems dependable.
          </p>
          <div className="mt-8 flex items-center gap-3 text-xs text-muted sm:mt-10">
            <span className="size-2 rounded-full bg-success" aria-hidden="true" />
            Built for a clearer view of your systems
          </div>
        </section>

        <section className="w-full rounded-panel border border-line bg-surface p-6 shadow-panel sm:p-8">
          <div className="mb-7">
            <p className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-accent">
              Welcome back
            </p>
            <h1 className="text-3xl font-semibold tracking-tight text-ink">
              Sign in to Sentinel
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted">
              Access your monitors and observability workspace.
            </p>
          </div>

          <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
            <div className="flex flex-col gap-2">
              <label htmlFor="username" className="text-sm font-medium text-ink">
                Username or email
              </label>
              <input
                id="username"
                type="text"
                autoComplete="username"
                placeholder="you@example.com"
                aria-invalid={errors.username !== undefined}
                aria-describedby={errors.username ? "username-error" : undefined}
                {...register("username")}
                className="h-11 w-full rounded-control border border-line-strong bg-canvas px-3 text-sm text-ink outline-none placeholder:text-subtle focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
              {errors.username !== undefined && (
                <span id="username-error" className="text-xs text-danger">
                  {errors.username.message}
                </span>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="password" className="text-sm font-medium text-ink">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="Enter your password"
                aria-invalid={errors.password !== undefined}
                aria-describedby={errors.password ? "password-error" : undefined}
                {...register("password")}
                className="h-11 w-full rounded-control border border-line-strong bg-canvas px-3 text-sm text-ink outline-none placeholder:text-subtle focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
              {errors.password !== undefined && (
                <span id="password-error" className="text-xs text-danger">
                  {errors.password.message}
                </span>
              )}
            </div>
            {errors.root !== undefined && (
              <p role="alert" className="text-sm text-danger">
                {errors.root.message}
              </p>
            )}
            <button
              type="submit"
              disabled={isSubmitting}
              className="mt-1 h-11 w-full rounded-control bg-accent-strong px-4 text-sm font-semibold text-canvas shadow-sm hover:bg-accent hover:shadow-glow disabled:cursor-not-allowed disabled:opacity-50"
            >
              Sign in
            </button>
          </form>

          <div className="my-6 flex items-center gap-3 text-[10px] uppercase tracking-[0.18em] text-muted">
            <span className="h-px flex-1 bg-line" />
            Demo access
            <span className="h-px flex-1 bg-line" />
          </div>
          {demoError !== null && (
            <p role="alert" className="mb-3 text-center text-sm text-danger">
              {demoError}
            </p>
          )}
          <button
            type="button"
            disabled={demoSubmitting}
            onClick={onDemoLogin}
            className="h-11 w-full rounded-control border border-accent/40 bg-accent-soft px-4 text-sm font-semibold text-accent hover:border-accent hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {demoSubmitting ? "Opening demo…" : "Try the demo"}
          </button>
          <p className="mt-3 break-all text-center font-mono text-[11px] leading-5 text-muted">
            Demo credentials: {demoEmail} / {demoPassword}
          </p>

          <div className="mt-7 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 border-t border-line pt-5 text-center text-sm text-muted">
            <span>New to Sentinel?</span>
            <button
              type="button"
              disabled
              aria-describedby="registration-note"
              className="cursor-not-allowed font-medium text-accent opacity-70"
            >
              Create account
            </button>
            <span id="registration-note" className="w-full text-xs text-subtle">
              Coming soon
            </span>
          </div>
          <Link
            to="/status"
            className="mt-5 flex w-full items-center justify-center border-t border-line pt-4 text-sm text-muted hover:text-accent"
          >
            View system status <span aria-hidden="true" className="ml-2">↗</span>
          </Link>
        </section>
      </div>
    </main>
  );
}

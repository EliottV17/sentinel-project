import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ApiError } from "../../app/api/client";
import { useAuth } from "../../app/auth/AuthProvider";
import { SentinelBrand } from "../../components/SentinelBrand";

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
  const accountCreated =
    location.state !== null &&
    typeof location.state === "object" &&
    "accountCreated" in location.state &&
    (location.state as { accountCreated: unknown }).accountCreated === true;
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
    <main className="flex min-h-screen items-center justify-center px-4 py-8 text-ink sm:px-8 sm:py-12">
      <section className="w-full max-w-md min-w-0 rounded-panel border border-line bg-surface p-5 shadow-panel sm:p-6">
          <div className="mb-6">
            <SentinelBrand />
            <h1 className="mt-6 font-serif text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
              Sign in
            </h1>
            <p className="mt-2 text-base leading-7 text-muted">
              Sign in to manage your monitors.
            </p>
          </div>

          {accountCreated && (
            <p role="status" className="mb-5 rounded-control border border-success/30 bg-success-soft px-3 py-2 text-sm text-success">
              Account created successfully. Sign in with your new credentials.
            </p>
          )}
          <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
            <p className="text-xs text-muted">All fields are required.</p>
            <div className="flex flex-col gap-2">
              <label htmlFor="username" className="text-sm font-medium text-ink">
                Username or email
              </label>
              <input
                id="username"
                type="text"
                autoComplete="username"
                placeholder="you@example.com"
                required
                aria-invalid={errors.username !== undefined}
                aria-describedby={errors.username ? "username-error" : undefined}
                {...register("username")}
                className="h-11 w-full rounded-control border border-line-strong bg-canvas px-3 text-sm text-ink outline-none placeholder:text-subtle transition duration-150 hover:border-accent/40 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
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
                required
                aria-invalid={errors.password !== undefined}
                aria-describedby={errors.password ? "password-error" : undefined}
                {...register("password")}
                className="h-11 w-full rounded-control border border-line-strong bg-canvas px-3 text-sm text-ink outline-none placeholder:text-subtle transition duration-150 hover:border-accent/40 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
              />
              {errors.password !== undefined && (
                <span id="password-error" className="text-xs text-danger">
                  {errors.password.message}
                </span>
              )}
            </div>
            {errors.root !== undefined && (
              <p role="alert" className="rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
                {errors.root.message}
              </p>
            )}
            <button
              type="submit"
              disabled={isSubmitting}
              className="mt-1 h-11 w-full rounded-control bg-accent-strong px-4 text-sm font-semibold text-canvas shadow-sm transition duration-150 hover:bg-accent hover:shadow-glow active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100"
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
            <p role="alert" className="mb-3 rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-center text-sm text-danger">
              {demoError}
            </p>
          )}
          <button
            type="button"
            disabled={demoSubmitting}
            onClick={onDemoLogin}
            className="h-11 w-full rounded-control border border-accent/40 bg-accent-soft px-4 text-sm font-semibold text-accent transition duration-150 hover:border-accent hover:bg-accent/20 hover:shadow-glow active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100"
          >
            {demoSubmitting ? "Opening demo…" : "Try the demo"}
          </button>
          <p className="mt-3 text-center text-xs text-muted">Explore the demo. Data resets every hour.</p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 border-t border-line pt-5 text-center text-sm text-muted">
            <span>New to Sentinel?</span>
            <Link to="/register" className="font-medium text-accent underline-offset-4 transition duration-150 hover:text-accent-strong hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
              Create account
            </Link>
          </div>
          <Link
            to="/status"
            className="mt-5 flex w-full items-center justify-center border-t border-line pt-4 text-sm text-muted transition duration-150 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            View system status
          </Link>
      </section>
    </main>
  );
}

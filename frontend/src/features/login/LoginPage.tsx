import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ApiError } from "../../app/api/client";
import { useAuth } from "../../app/auth/AuthProvider";

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

  // Already authenticated visitors never see the form — but a successful
  // login from this page owns the post-login navigation (to `from`), so the
  // redirect must not fight it.
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
    <div className="mx-auto mt-24 max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="mb-4 text-xl font-semibold text-slate-900">
        Sign in to Sentinel
      </h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1">
          <label htmlFor="username" className="text-sm text-slate-700">
            Username
          </label>
          <input
            id="username"
            type="text"
            autoComplete="username"
            {...register("username")}
            className="rounded border border-slate-300 px-3 py-2 text-sm"
          />
          {errors.username !== undefined && (
            <span className="text-xs text-red-600">
              {errors.username.message}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="password" className="text-sm text-slate-700">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            {...register("password")}
            className="rounded border border-slate-300 px-3 py-2 text-sm"
          />
          {errors.password !== undefined && (
            <span className="text-xs text-red-600">
              {errors.password.message}
            </span>
          )}
        </div>
        {errors.root !== undefined && (
          <p role="alert" className="text-sm text-red-600">
            {errors.root.message}
          </p>
        )}
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          Sign in
        </button>
      </form>
      <p className="mt-4 text-center text-xs text-slate-500">
        <Link to="/status" className="underline underline-offset-2 hover:text-slate-800">
          Estado del sistema
        </Link>
      </p>
      <div className="mt-4 border-t border-slate-200 pt-4 text-sm text-slate-600">
        <p>Demo credentials: {demoEmail} / {demoPassword}</p>
        {demoError !== null && <p role="alert" className="mt-2 text-red-600">{demoError}</p>}
        <button
          type="button"
          disabled={demoSubmitting}
          onClick={onDemoLogin}
          className="mt-3 w-full rounded border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-50"
        >
          Probar demo
        </button>
      </div>
    </div>
  );
}

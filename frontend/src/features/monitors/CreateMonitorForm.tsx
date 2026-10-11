import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ApiError } from "../../app/api/client";
import { CHECKER_CONFIG_SCHEMA, DEFAULT_CHECK_TYPE } from "../../lib/checkers";
import { useCreateMonitor } from "./useMonitorMutations";

/**
 * Client validation mirroring the server constraints: name 1–100 required,
 * target must parse via `new URL()`, frequency int ≥ 10 with default 60.
 * `check_type` is locked to the only registered checker; `check_config` is
 * posted verbatim from the CHECKER_CONFIG_SCHEMA constant.
 */
const createSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(100, "Name must be at most 100 characters"),
  target: z
    .string()
    .min(1, "Target is required")
    .refine(
      (value) => {
        try {
          void new URL(value);
          return true;
        } catch {
          return false;
        }
      },
      { message: "Target must be a valid URL" },
    )
    .refine(
      (value) => {
        try {
          const protocol = new URL(value).protocol;
          return protocol === "http:" || protocol === "https:";
        } catch {
          return true;
        }
      },
      { message: "Enter a valid HTTP or HTTPS URL." },
    )
    .refine(
      (value) => {
        try {
          const hostname = new URL(value).hostname.toLowerCase();
          return hostname !== "localhost" && !hostname.endsWith(".localhost");
        } catch {
          return true;
        }
      },
      { message: "Localhost targets are not supported. Enter a public HTTP or HTTPS URL." },
    ),
  frequency: z
    .number({ message: "Frequency must be at least 10 seconds" })
    .int("Frequency must be at least 10 seconds")
    .min(10, "Frequency must be at least 10 seconds"),
});

type CreateValues = z.infer<typeof createSchema>;

type MonitorField = "name" | "target" | "frequency";

function apiErrorMessage(error: ApiError): string {
  if (error.status === 429) return "Too many requests. Please wait before creating a monitor.";
  if (error.status === 403) return "You do not have permission to create this monitor.";
  if (error.status === 409) return "Your monitor limit has been reached.";
  if (error.status === 400 || error.status === 422) {
    if (/already exists/i.test(error.message)) return "Target already exists";
    return "Check the monitor details and try again.";
  }
  if (error.status >= 500) return "The monitor service is temporarily unavailable. Try again in a moment.";
  return "Unable to create this monitor. Check the details and try again.";
}

function fieldErrorMessage(field: MonitorField, detail?: string): string {
  if (detail && !/[áéíóúñ¿¡]|error|debe|deben|inválid|obligatori|superior|inferior|mínim|máxim/i.test(detail)) {
    if (field === "frequency" && /greater than or equal to 10/i.test(detail)) {
      return "value must be greater than or equal to 10";
    }
  }
  if (field === "name") return "Enter a valid monitor name.";
  if (field === "target") return "Enter a valid public HTTP or HTTPS URL.";
  return "Choose a check frequency allowed for your account.";
}

export function CreateMonitorForm({
  autoFocus = false,
  onCreated,
  onCancel,
  onPendingChange,
}: {
  autoFocus?: boolean;
  onCreated?: () => void;
  onCancel?: () => void;
  onPendingChange?: (pending: boolean) => void;
} = {}) {
  const createMonitor = useCreateMonitor();
  const submissionInFlight = useRef(false);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { name: "", target: "", frequency: 60 },
  });

  useEffect(() => {
    if (!onCancel) return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !isSubmitting && !submissionInFlight.current && !createMonitor.isPending) {
        event.preventDefault();
        onCancel();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [createMonitor.isPending, isSubmitting, onCancel]);

  const cancel = (): void => {
    if (isSubmitting || submissionInFlight.current || createMonitor.isPending) return;
    onCancel?.();
  };

  const onSubmit = handleSubmit(
    (values) => {
      if (submissionInFlight.current) return;
      submissionInFlight.current = true;
      onPendingChange?.(true);
      createMonitor.mutate(
        {
          name: values.name,
          target: values.target,
          frequency: values.frequency,
          check_type: DEFAULT_CHECK_TYPE,
          check_config: { ...CHECKER_CONFIG_SCHEMA.http },
        },
        {
          onSuccess: () => {
            reset();
            onCreated?.();
          },
          onError: (err) => {
            if (err instanceof ApiError) {
              for (const [field, detail] of Object.entries(err.fields ?? {})) {
                if (field === "name" || field === "target" || field === "frequency") {
                  setError(field, { message: fieldErrorMessage(field, detail) });
                }
              }
              setError("root", { message: apiErrorMessage(err) });
            } else {
              setError("root", { message: "Unable to reach the monitor service. Check your connection and try again." });
            }
          },
          onSettled: () => {
            submissionInFlight.current = false;
            onPendingChange?.(false);
          },
        },
      );
    },
  );

  return (
    <form
      onSubmit={(event) => {
        void onSubmit(event);
      }}
      className="flex flex-col gap-4"
      noValidate
    >
      <p className="text-xs text-muted">All fields are required.</p>
      <div className="flex min-w-0 flex-col gap-2">
        <label htmlFor="monitor-name" className="text-sm font-medium text-ink">
          Name
        </label>
        <input
          id="monitor-name"
          type="text"
          autoFocus={autoFocus}
          required
          aria-describedby={errors.name ? "monitor-name-error" : undefined}
          aria-invalid={errors.name !== undefined}
          {...register("name")}
          className="h-11 w-full min-w-0 rounded-control border border-line-strong bg-canvas px-3 text-sm text-ink outline-none transition duration-150 hover:border-accent/40 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
        {errors.name !== undefined && (
          <span id="monitor-name-error" className="text-xs text-danger">{errors.name.message}</span>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <label htmlFor="monitor-target" className="text-sm font-medium text-ink">
          Target
        </label>
        <input
          id="monitor-target"
          type="text"
          required
          placeholder="https://example.com"
          aria-invalid={errors.target !== undefined}
          aria-describedby={`monitor-target-hint${errors.target ? " monitor-target-error" : ""}`}
          {...register("target")}
          className="h-11 w-full min-w-0 rounded-control border border-line-strong bg-canvas px-3 text-sm text-ink placeholder:text-subtle outline-none transition duration-150 hover:border-accent/40 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
        <span id="monitor-target-hint" className="text-xs text-muted">Use a public HTTP or HTTPS URL. Localhost targets are not supported; server-side security checks still apply.</span>
        {errors.target !== undefined && (
          <span id="monitor-target-error" className="text-xs text-danger">{errors.target.message}</span>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <label htmlFor="monitor-frequency" className="text-sm font-medium text-ink">
          Frequency (seconds)
        </label>
        <input
          id="monitor-frequency"
          type="number"
          required
          aria-invalid={errors.frequency !== undefined}
          aria-describedby={errors.frequency ? "monitor-frequency-error" : undefined}
          {...register("frequency", { valueAsNumber: true })}
          className="h-11 w-full min-w-0 rounded-control border border-line-strong bg-canvas px-3 text-sm text-ink outline-none transition duration-150 hover:border-accent/40 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
        {errors.frequency !== undefined && (
          <span id="monitor-frequency-error" className="text-xs text-danger">
            {errors.frequency.message}
          </span>
        )}
      </div>
      {errors.root !== undefined && (
        <p role="alert" className="rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {errors.root.message}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={isSubmitting || createMonitor.isPending}
          className="min-h-11 rounded-control bg-accent-strong px-4 py-2.5 text-sm font-semibold text-canvas shadow-sm transition duration-150 hover:bg-accent hover:shadow-glow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {createMonitor.isPending ? "Creating monitor…" : "Create monitor"}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={cancel}
            disabled={isSubmitting || createMonitor.isPending}
            className="min-h-11 rounded-control border border-line-strong px-4 py-2.5 text-sm font-medium text-muted transition duration-150 hover:border-accent hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
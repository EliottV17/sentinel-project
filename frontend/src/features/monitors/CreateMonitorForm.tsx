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

export function CreateMonitorForm() {
  const createMonitor = useCreateMonitor();
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

  const onSubmit = handleSubmit(
    (values) => {
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
      <div className="flex min-w-0 flex-col gap-2">
        <label htmlFor="monitor-name" className="text-sm font-medium text-ink">
          Name
        </label>
        <input
          id="monitor-name"
          type="text"
          aria-invalid={errors.name !== undefined}
          {...register("name")}
          className="h-11 w-full min-w-0 rounded-control border border-line-strong bg-canvas px-3 text-sm text-ink outline-none transition duration-150 hover:border-accent/40 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
        {errors.name !== undefined && (
          <span className="text-xs text-danger">{errors.name.message}</span>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <label htmlFor="monitor-target" className="text-sm font-medium text-ink">
          Target
        </label>
        <input
          id="monitor-target"
          type="text"
          placeholder="https://example.com"
          aria-invalid={errors.target !== undefined}
          {...register("target")}
          className="h-11 w-full min-w-0 rounded-control border border-line-strong bg-canvas px-3 text-sm text-ink placeholder:text-subtle outline-none transition duration-150 hover:border-accent/40 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
        {errors.target !== undefined && (
          <span className="text-xs text-danger">{errors.target.message}</span>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <label htmlFor="monitor-frequency" className="text-sm font-medium text-ink">
          Frequency (seconds)
        </label>
        <input
          id="monitor-frequency"
          type="number"
          aria-invalid={errors.frequency !== undefined}
          {...register("frequency", { valueAsNumber: true })}
          className="h-11 w-full min-w-0 rounded-control border border-line-strong bg-canvas px-3 text-sm text-ink outline-none transition duration-150 hover:border-accent/40 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
        {errors.frequency !== undefined && (
          <span className="text-xs text-danger">
            {errors.frequency.message}
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
        className="self-start rounded-control bg-accent-strong px-4 py-2.5 text-sm font-semibold text-canvas shadow-sm transition duration-150 hover:bg-accent hover:shadow-glow active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100"
      >
        Create monitor
      </button>
    </form>
  );
}
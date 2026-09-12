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
              for (const [field, message] of Object.entries(err.fields ?? {})) {
                if (field === "name" || field === "target" || field === "frequency") {
                  setError(field, { message });
                }
              }
              setError("root", { message: err.fields?._form ?? err.message });
            } else {
              setError("root", { message: "API unreachable" });
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
      className="flex flex-col gap-3"
      noValidate
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="monitor-name" className="text-sm text-slate-700">
          Name
        </label>
        <input
          id="monitor-name"
          type="text"
          aria-invalid={errors.name !== undefined}
          {...register("name")}
          className="rounded border border-slate-300 px-3 py-2 text-sm"
        />
        {errors.name !== undefined && (
          <span className="text-xs text-red-600">{errors.name.message}</span>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="monitor-target" className="text-sm text-slate-700">
          Target
        </label>
        <input
          id="monitor-target"
          type="text"
          placeholder="https://example.com"
          aria-invalid={errors.target !== undefined}
          {...register("target")}
          className="rounded border border-slate-300 px-3 py-2 text-sm"
        />
        {errors.target !== undefined && (
          <span className="text-xs text-red-600">{errors.target.message}</span>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="monitor-frequency" className="text-sm text-slate-700">
          Frequency (seconds)
        </label>
        <input
          id="monitor-frequency"
          type="number"
          aria-invalid={errors.frequency !== undefined}
          {...register("frequency", { valueAsNumber: true })}
          className="rounded border border-slate-300 px-3 py-2 text-sm"
        />
        {errors.frequency !== undefined && (
          <span className="text-xs text-red-600">
            {errors.frequency.message}
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
        className="self-start rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
      >
        Create monitor
      </button>
    </form>
  );
}
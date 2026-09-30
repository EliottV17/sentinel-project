/**
 * FastAPI error-detail normalization.
 *
 * FastAPI error bodies are `{"detail": string | [{loc, msg, type}, ...]}`.
 * String details are form-level messages; list details are field-validation
 * errors whose last `loc` segment names the offending form field (e.g.
 * `frequency`). Shared by the login form (PR 2) and the create form (PR 3).
 */

export interface NormalizedDetail {
  message?: string;
  fields: Record<string, string>;
}

export function normalizeDetail(detail: unknown): NormalizedDetail {
  if (typeof detail === "string") {
    return { message: detail, fields: {} };
  }

  if (Array.isArray(detail)) {
    const fields: Record<string, string> = {};
    for (const item of detail) {
      if (item !== null && typeof item === "object" && "msg" in item) {
        const loc = (item as { loc?: unknown }).loc;
        const field = Array.isArray(loc)
          ? loc.length
            ? String(loc[loc.length - 1])
            : "detail"
          : String(loc ?? "detail");
        fields[field] = String((item as { msg: unknown }).msg);
      }
    }
    return { fields };
  }

  return { fields: {} };
}

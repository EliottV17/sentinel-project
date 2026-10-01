/**
 * API error-detail normalization supporting both NestJS and FastAPI schemas.
 *
 * NestJS validation errors: `{"message": ["target must be a valid URL...", ...]}`
 * NestJS exception errors: `{"statusCode": 400|429, "message": "..."}`
 * FastAPI error bodies: `{"detail": string | [{loc, msg, type}, ...]}`
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
    const messages: string[] = [];

    for (const item of detail) {
      if (typeof item === "string") {
        messages.push(item);
        const lower = item.toLowerCase();
        if (lower.includes("target")) fields.target = item;
        if (lower.includes("frequency")) fields.frequency = item;
        if (lower.includes("name")) fields.name = item;
      } else if (item !== null && typeof item === "object" && "msg" in item) {
        const loc = (item as { loc?: unknown }).loc;
        const field = Array.isArray(loc)
          ? loc.length
            ? String(loc[loc.length - 1])
            : "detail"
          : String(loc ?? "detail");
        fields[field] = String((item as { msg: unknown }).msg);
      }
    }

    return {
      message: messages.length > 0 ? messages.join(". ") : undefined,
      fields,
    };
  }

  return { fields: {} };
}

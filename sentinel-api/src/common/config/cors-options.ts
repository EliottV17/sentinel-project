export interface CorsOptions {
  origin: string | string[];
  credentials: true;
}

function productionOrigins(value: string | undefined): string[] {
  const entries = value?.split(',').map((origin) => origin.trim()) ?? [];
  const origins = entries.filter(Boolean);
  if (
    origins.length === 0 ||
    entries.some((origin) => !origin) ||
    origins.some((origin) => origin.includes('*'))
  ) {
    throw new Error('CORS_ORIGINS must contain explicit HTTP(S) origins in production');
  }

  for (const origin of origins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error('CORS_ORIGINS must contain explicit HTTP(S) origins in production');
    }

    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.origin !== origin ||
      parsed.username !== '' ||
      parsed.password !== ''
    ) {
      throw new Error('CORS_ORIGINS must contain explicit HTTP(S) origins in production');
    }
  }

  return origins;
}

export function getCorsOptions(
  corsOrigins: string | undefined,
  nodeEnv: string | undefined,
): CorsOptions {
  if (nodeEnv === 'production') {
    return { origin: productionOrigins(corsOrigins), credentials: true };
  }

  const allowedOrigins = corsOrigins
    ? corsOrigins.split(',').map((origin) => origin.trim()).filter(Boolean)
    : '*';
  return { origin: allowedOrigins, credentials: true };
}

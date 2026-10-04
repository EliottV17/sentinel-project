import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateSecretKey } from '../../auth/utils/secret-validator';
import { getCorsOptions } from './cors-options';

const REQUIRED_SETTINGS = [
  'DATABASE_URL',
  'SECRET_KEY',
  'DEMO_USER_EMAIL',
  'DEMO_USER_PASSWORD',
  'STATUS_OWNER_EMAIL',
  'CORS_ORIGINS',
] as const;

function requireEmail(name: string, value: string): void {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new Error(`${name} must be a valid email address`);
  }
}

function validateManifest(name: string, configuredPath: string | undefined, fallback: string): void {
  const path = resolve(configuredPath?.trim() || fallback);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error(`${name} must point to an available valid JSON manifest`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${name} must point to a JSON array manifest`);
  }
  for (const entry of parsed) {
    if (
      !entry ||
      typeof entry !== 'object' ||
      typeof entry.seed_key !== 'string' ||
      !entry.seed_key.trim() ||
      typeof entry.name !== 'string' ||
      !entry.name.trim() ||
      typeof entry.target !== 'string' ||
      !entry.target.trim()
    ) {
      throw new Error(`${name} contains an invalid seed entry`);
    }
    if (
      name === 'DEMO_MONITORS_MANIFEST_PATH' &&
      (typeof entry.check_type !== 'string' ||
        !entry.check_config ||
        typeof entry.check_config !== 'object' ||
        !Number.isInteger(entry.frequency) ||
        entry.frequency <= 0)
    ) {
      throw new Error(`${name} contains an invalid demo seed entry`);
    }
    if (entry.frequency !== undefined && (!Number.isInteger(entry.frequency) || entry.frequency <= 0)) {
      throw new Error(`${name} contains an invalid monitor frequency`);
    }
  }
}

export function validateProductionEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== 'production') return;

  for (const name of REQUIRED_SETTINGS) {
    if (!env[name]?.trim()) throw new Error(`${name} is required in production`);
  }

  const databaseUrl = env.DATABASE_URL as string;
  let database: URL;
  try {
    database = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL');
  }
  if (
    !['postgres:', 'postgresql:'].includes(database.protocol) ||
    !database.hostname ||
    !database.username ||
    !database.password
  ) {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL with credentials');
  }
  let databasePassword: string;
  try {
    databasePassword = decodeURIComponent(database.password);
  } catch {
    throw new Error('DATABASE_URL contains invalid connection credentials');
  }
  if (databasePassword === 'postgres') {
    throw new Error('DATABASE_URL must not use the known default PostgreSQL password');
  }

  validateSecretKey({ get: (name: string) => env[name] } as ConfigService);
  try {
    getCorsOptions(env.CORS_ORIGINS, 'production');
  } catch {
    throw new Error('CORS_ORIGINS must contain only explicit valid HTTP(S) origins in production');
  }

  requireEmail('DEMO_USER_EMAIL', env.DEMO_USER_EMAIL as string);
  requireEmail('STATUS_OWNER_EMAIL', env.STATUS_OWNER_EMAIL as string);
  if (env.DEMO_USER_EMAIL?.toLowerCase() === env.STATUS_OWNER_EMAIL?.toLowerCase()) {
    throw new Error('STATUS_OWNER_EMAIL must be different from DEMO_USER_EMAIL');
  }

  validateManifest('DEMO_MONITORS_MANIFEST_PATH', env.DEMO_MONITORS_MANIFEST_PATH, '/app/demo-monitors.json');
  validateManifest('STATUS_MONITORS_MANIFEST_PATH', env.STATUS_MONITORS_MANIFEST_PATH, '/app/status-monitors.json');
}

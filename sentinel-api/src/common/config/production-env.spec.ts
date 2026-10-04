import { validateProductionEnvironment } from './production-env';

describe('validateProductionEnvironment', () => {
  const validEnv = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://sentinel:local-test-password@db:5432/sentinel',
    SECRET_KEY: 'phase4-production-test-secret-with-more-than-32-characters',
    DEMO_USER_EMAIL: 'demo@example.test',
    DEMO_USER_PASSWORD: 'DemoPassword123!',
    STATUS_OWNER_EMAIL: 'status@example.test',
    CORS_ORIGINS: 'https://localhost',
    DEMO_MONITORS_MANIFEST_PATH: '/workspace/demo-monitors.json',
    STATUS_MONITORS_MANIFEST_PATH: '/workspace/status-monitors.json',
  };

  it.each([
    'DATABASE_URL',
    'SECRET_KEY',
    'DEMO_USER_EMAIL',
    'DEMO_USER_PASSWORD',
    'STATUS_OWNER_EMAIL',
    'CORS_ORIGINS',
  ])('rejects missing or blank %s', (name) => {
    for (const value of [undefined, '   ']) {
      expect(() => validateProductionEnvironment({ ...validEnv, [name]: value })).toThrow(name);
    }
  });

  it('accepts valid production settings', () => {
    expect(() => validateProductionEnvironment(validEnv)).not.toThrow();
  });

  it.each([
    { DEMO_USER_EMAIL: 'not-an-email' },
    { STATUS_OWNER_EMAIL: 'not-an-email' },
    { STATUS_OWNER_EMAIL: 'demo@example.test' },
    { SECRET_KEY: 'default-secret-key' },
    { DATABASE_URL: 'postgresql://postgres:postgres@db:5432/sentinel' },
    { CORS_ORIGINS: 'https://example.test,*' },
    { DATABASE_URL: 'postgresql://sentinel:%ZZ@db:5432/sentinel' },
    { DEMO_MONITORS_MANIFEST_PATH: '/workspace/not-mounted.json' },
    { STATUS_MONITORS_MANIFEST_PATH: '/workspace/not-mounted.json' },
  ])('rejects invalid production setting %#', (override) => {
    expect(() => validateProductionEnvironment({ ...validEnv, ...override })).toThrow();
  });
});

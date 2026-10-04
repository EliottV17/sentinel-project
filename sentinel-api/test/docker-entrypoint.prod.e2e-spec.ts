import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const sourceRoot = resolve(__dirname, '..');
const baseEnv = {
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

describe('production Docker entrypoint', () => {
  function fixture(overrides: Record<string, string> = {}) {
    const root = mkdtempSync(join(tmpdir(), 'sentinel-prod-startup-'));
    mkdirSync(join(root, 'dist/common/config'), { recursive: true });
    mkdirSync(join(root, 'dist/auth/utils'), { recursive: true });
    mkdirSync(join(root, 'node_modules/.bin'), { recursive: true });
    mkdirSync(join(root, 'prisma'), { recursive: true });
    writeFileSync(join(root, 'docker-entrypoint.prod.sh'), readFileSync(join(sourceRoot, 'docker-entrypoint.prod.sh')));
    for (const artifact of [
      ['common/config/production-env.js', 'common/config/production-env.js'],
      ['common/config/cors-options.js', 'common/config/cors-options.js'],
      ['auth/utils/secret-validator.js', 'auth/utils/secret-validator.js'],
    ]) {
      writeFileSync(join(root, 'dist', artifact[0]), readFileSync(join(sourceRoot, 'dist', artifact[1])));
    }
    writeFileSync(join(root, 'node_modules/.bin/prisma'), '#!/bin/sh\nprintf "migration:%s\\n" "$*" >>"$CALL_LOG"\nexit "${MIGRATE_EXIT:-0}"\n', { mode: 0o755 });
    const mockBin = join(root, 'mock-bin');
    mkdirSync(mockBin);
    writeFileSync(
      join(mockBin, 'node'),
      '#!/bin/sh\nif [ "$1" = "-e" ]; then exec /usr/bin/node "$@"; fi\nprintf "node:%s\\n" "$*" >>"$CALL_LOG"\ncase "$*" in *seed-dist/prisma/seed.js*) exit "${SEED_EXIT:-0}";; esac\nexit 0\n',
      { mode: 0o755 },
    );
    writeFileSync(join(root, 'prisma/schema.prisma'), '');
    const log = join(root, 'calls.log');
    writeFileSync(log, '');
    const result = (env: Record<string, string | undefined> = {}) => spawnSync('/bin/sh', ['./docker-entrypoint.prod.sh'], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        ...baseEnv,
        ...overrides,
        CALL_LOG: log,
        NODE_PATH: join(sourceRoot, 'node_modules'),
        PATH: `${mockBin}:${process.env.PATH}`,
        ...env,
      },
    });
    return { root, log, result };
  }

  it('rejects missing settings before invoking migrations', () => {
    const test = fixture({ DATABASE_URL: '' });
    const result = test.result();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('DATABASE_URL');
    expect(readFileSync(test.log, 'utf8')).toBe('');
  });

  it('does not seed or start the server when migrations fail', () => {
    const test = fixture();
    const result = test.result({ MIGRATE_EXIT: '1' });
    const calls = readFileSync(test.log, 'utf8');
    expect(result.status).not.toBe(0);
    expect(calls).toContain('migration:migrate deploy --schema=./prisma/schema.prisma');
    expect(calls).not.toContain('seed-dist');
    expect(calls).not.toContain('dist/main.js');
  });

  it('does not start the server when compiled seed fails', () => {
    const test = fixture();
    const result = test.result({ SEED_EXIT: '1' });
    const calls = readFileSync(test.log, 'utf8');
    expect(result.status).not.toBe(0);
    expect(calls).toContain('seed-dist/prisma/seed.js');
    expect(calls).not.toContain('dist/main.js');
  });

  it('runs migration, compiled seed, then the server', () => {
    const test = fixture();
    const result = test.result();
    expect(result.status).toBe(0);
    const calls = readFileSync(test.log, 'utf8').trim().split('\n');
    expect(calls).toEqual([
      'migration:migrate deploy --schema=./prisma/schema.prisma',
      'node:./seed-dist/prisma/seed.js',
      'node:./dist/main.js',
    ]);
  });
});

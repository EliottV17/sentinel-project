import { PrismaClient } from '@prisma/client';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DemoSeed } from '../src/demo/demo-seed';
import { StatusSeed } from '../src/status/status-seed';

async function main() {
  const email = process.env.DEMO_USER_EMAIL;
  const password = process.env.DEMO_USER_PASSWORD;
  if (!email || !password) {
    throw new Error('DEMO_USER_EMAIL and DEMO_USER_PASSWORD must be configured');
  }
  const path = resolve(process.env.DEMO_MONITORS_MANIFEST_PATH ?? '../demo-monitors.json');
  const monitors = JSON.parse(await readFile(path, 'utf8'));
  const prisma = new PrismaClient();
  try {
    if (process.env.STATUS_OWNER_EMAIL) {
      const statusPath = resolve(process.env.STATUS_MONITORS_MANIFEST_PATH ?? '../status-monitors.json');
      const statusMonitors = JSON.parse(await readFile(statusPath, 'utf8'));
      await new StatusSeed(prisma).seed(statusMonitors);
    }
    await new DemoSeed(prisma).seed({ user: { email, password }, monitors });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

import { PrismaClient } from '@prisma/client';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DemoSeed } from '../src/demo/demo-seed';

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
    await new DemoSeed(prisma).seed({ user: { email, password }, monitors });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

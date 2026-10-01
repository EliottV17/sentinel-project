import { BadRequestException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { IsValidTargetConstraint } from '../monitors/validators/is-valid-target.validator';

type DemoManifest = {
  user: { email: string; password: string };
  monitors: Array<{
    seed_key: string;
    name: string;
    target: string;
    frequency: number;
    check_type: string;
    check_config: Record<string, unknown>;
  }>;
};

export class DemoSeed {
  constructor(private readonly prisma: any) {}

  async seed(manifest: DemoManifest): Promise<void> {
    const maxMonitors = Number(process.env.DEMO_MAX_MONITORS ?? 3);
    if (!Number.isInteger(maxMonitors) || maxMonitors <= manifest.monitors.length) {
      throw new BadRequestException('DEMO_MAX_MONITORS must leave at least one free monitor slot');
    }
    const targetValidator = new IsValidTargetConstraint();
    for (const monitor of manifest.monitors) {
      if (!monitor.seed_key || !targetValidator.validate(monitor.target, null as never)) {
        throw new BadRequestException(`Invalid demo monitor manifest entry: ${monitor.seed_key}`);
      }
    }

    const password = process.env.DEMO_USER_PASSWORD ?? manifest.user.password;
    const email = process.env.DEMO_USER_EMAIL ?? manifest.user.email;
    const hashedPassword = await argon2.hash(password);
    const user = await this.prisma.users.upsert({
      where: { email },
      update: { password: hashedPassword, is_demo: true },
      create: {
        email,
        username: email,
        name: 'Demo',
        last_name: 'User',
        password: hashedPassword,
        status: 'Active',
        is_active: true,
        is_demo: true,
        created_at: new Date(),
        updated_at: new Date(),
      },
      select: { id: true },
    });

    for (const monitor of manifest.monitors) {
      const values = {
        name: monitor.name,
        target: monitor.target,
        frequency: monitor.frequency,
        state: 'Active',
        check_type: monitor.check_type,
        check_config: monitor.check_config,
        consecutive_failures: 0,
      };
      await this.prisma.monitor.upsert({
        where: { user_id_seed_key: { user_id: user.id, seed_key: monitor.seed_key } },
        update: values,
        create: {
          ...values,
          seed_key: monitor.seed_key,
          user_id: user.id,
          created_at: new Date(),
        },
      });
    }
  }
}

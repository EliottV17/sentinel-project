import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IsValidTargetConstraint } from '../monitors/validators/is-valid-target.validator';

export type StatusManifest = Array<{
  seed_key: string;
  name: string;
  target: string;
  frequency?: number;
}>;

// Deliberately malformed as an Argon2 hash so normal authentication rejects it.
const DISABLED_OWNER_PASSWORD = 'STATUS_SEED_DISABLED_PASSWORD_SENTINEL';

export class StatusSeed {
  constructor(private readonly prisma: any) {}

  async seed(manifest: StatusManifest): Promise<void> {
    if (!Array.isArray(manifest)) {
      throw new BadRequestException('Status monitor manifest must be an array');
    }

    const targetValidator = new IsValidTargetConstraint();
    const seedKeys = new Set<string>();
    for (const monitor of manifest) {
      if (
        !monitor ||
        typeof monitor.seed_key !== 'string' ||
        !monitor.seed_key.trim() ||
        seedKeys.has(monitor.seed_key) ||
        typeof monitor.name !== 'string' ||
        !monitor.name.trim() ||
        typeof monitor.target !== 'string' ||
        !targetValidator.validate(monitor.target, null as never) ||
        (monitor.frequency !== undefined &&
          (!Number.isInteger(monitor.frequency) || monitor.frequency <= 0))
      ) {
        throw new BadRequestException(`Invalid status monitor manifest entry: ${monitor?.seed_key ?? 'unknown'}`);
      }
      seedKeys.add(monitor.seed_key);
    }

    const ownerEmail = process.env.STATUS_OWNER_EMAIL;
    if (!ownerEmail) {
      const result = await this.prisma.$transaction((transaction: any) =>
        transaction.monitor.updateMany({ where: { is_public: true }, data: { is_public: false } }),
      );
      console.log(`Status publication reconciliation hid ${result.count} monitor(s)`);
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) {
      throw new BadRequestException('STATUS_OWNER_EMAIL must be a valid email address');
    }
    if (ownerEmail.toLowerCase() === process.env.DEMO_USER_EMAIL?.toLowerCase()) {
      throw new BadRequestException('STATUS_OWNER_EMAIL must be different from DEMO_USER_EMAIL');
    }

    const existing = await this.prisma.users.findUnique({ where: { email: ownerEmail } });
    if (
      existing &&
      (existing.is_demo !== false || existing.is_active !== false || existing.password !== DISABLED_OWNER_PASSWORD)
    ) {
      throw new BadRequestException(
        `STATUS_OWNER_EMAIL ${ownerEmail} already belongs to an account; refusing to take it over`,
      );
    }

    try {
      const hiddenCount = await this.prisma.$transaction(async (transaction: any) => {
        let ownerId = existing?.id;
        if (ownerId === undefined) {
          const owner = await transaction.users.create({
            data: {
              email: ownerEmail,
              username: ownerEmail,
              name: 'Public Status',
              last_name: 'Owner',
              password: DISABLED_OWNER_PASSWORD,
              status: 'Active',
              is_active: false,
              is_demo: false,
              created_at: new Date(),
              updated_at: new Date(),
            },
            select: { id: true },
          });
          ownerId = owner.id;
        }

        for (const monitor of manifest) {
          const values = {
            name: monitor.name,
            target: monitor.target,
            frequency: monitor.frequency ?? 60,
            state: 'Active',
            check_type: 'http',
            check_config: {},
            consecutive_failures: 0,
            is_public: true,
          };
          await transaction.monitor.upsert({
            where: { user_id_seed_key: { user_id: ownerId, seed_key: monitor.seed_key } },
            update: values,
            create: {
              ...values,
              seed_key: monitor.seed_key,
              user_id: ownerId,
              created_at: new Date(),
            },
          });
        }

        const where = manifest.length === 0
          ? { is_public: true }
          : {
              is_public: true,
              OR: [
                { user_id: { not: ownerId } },
                { user_id: ownerId, seed_key: null },
                { user_id: ownerId, seed_key: { notIn: [...seedKeys] } },
              ],
            };
        const result = await transaction.monitor.updateMany({ where, data: { is_public: false } });
        return result.count;
      });
      console.log(`Status publication reconciliation hid ${hiddenCount} monitor(s)`);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && !existing) {
        throw new BadRequestException(
          `STATUS_OWNER_EMAIL ${ownerEmail} collided with an existing account; refusing to take it over`,
        );
      }
      throw error;
    }
  }
}

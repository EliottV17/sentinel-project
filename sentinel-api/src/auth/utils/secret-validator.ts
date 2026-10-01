import { ConfigService } from '@nestjs/config';

export const INSECURE_DEFAULT_SECRETS = [
  'default-secret-key',
  'change-me-secret-key-sentinel',
  'change-me-to-a-random-secret',
];

export function validateSecretKey(configService: ConfigService): string {
  const nodeEnv = configService.get<string>('NODE_ENV', 'development');
  const secret = configService.get<string>('SECRET_KEY');

  const isProduction = nodeEnv === 'production';
  const isDefaultOrEmpty =
    !secret ||
    secret.trim() === '' ||
    INSECURE_DEFAULT_SECRETS.includes(secret.trim());

  if (isProduction && isDefaultOrEmpty) {
    throw new Error(
      'FATAL: In production, SECRET_KEY environment variable is mandatory and cannot be a default or placeholder value.',
    );
  }

  return secret || 'default-secret-key';
}

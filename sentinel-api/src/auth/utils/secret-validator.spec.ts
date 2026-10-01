import { ConfigService } from '@nestjs/config';
import { validateSecretKey } from './secret-validator';

describe('validateSecretKey', () => {
  it('allows default key in development or test environment', () => {
    const configService = {
      get: jest.fn((key: string, defaultValue?: any) => {
        if (key === 'NODE_ENV') return 'development';
        if (key === 'SECRET_KEY') return 'default-secret-key';
        return defaultValue;
      }),
    } as unknown as ConfigService;

    const secret = validateSecretKey(configService);
    expect(secret).toBe('default-secret-key');
  });

  it('allows strong secret in production environment', () => {
    const configService = {
      get: jest.fn((key: string, defaultValue?: any) => {
        if (key === 'NODE_ENV') return 'production';
        if (key === 'SECRET_KEY') return 'my-super-secure-production-random-key-12345';
        return defaultValue;
      }),
    } as unknown as ConfigService;

    const secret = validateSecretKey(configService);
    expect(secret).toBe('my-super-secure-production-random-key-12345');
  });

  it('throws fatal error in production when SECRET_KEY is missing or empty', () => {
    const configService = {
      get: jest.fn((key: string, defaultValue?: any) => {
        if (key === 'NODE_ENV') return 'production';
        if (key === 'SECRET_KEY') return '';
        return defaultValue;
      }),
    } as unknown as ConfigService;

    expect(() => validateSecretKey(configService)).toThrow(
      /FATAL: In production, SECRET_KEY environment variable is mandatory/,
    );
  });

  it('throws fatal error in production when default placeholder key is used', () => {
    const placeholders = [
      'default-secret-key',
      'change-me-secret-key-sentinel',
      'change-me-to-a-random-secret',
    ];

    for (const placeholder of placeholders) {
      const configService = {
        get: jest.fn((key: string, defaultValue?: any) => {
          if (key === 'NODE_ENV') return 'production';
          if (key === 'SECRET_KEY') return placeholder;
          return defaultValue;
        }),
      } as unknown as ConfigService;

      expect(() => validateSecretKey(configService)).toThrow(
        /FATAL: In production, SECRET_KEY environment variable is mandatory/,
      );
    }
  });
});

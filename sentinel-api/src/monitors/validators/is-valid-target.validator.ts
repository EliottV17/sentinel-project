import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ async: false })
export class IsValidTargetConstraint implements ValidatorConstraintInterface {
  validate(value: any, _args: ValidationArguments): boolean {
    if (typeof value !== 'string' || !value.trim()) {
      return false;
    }

    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      return false;
    }

    const protocol = parsed.protocol.toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') {
      return false;
    }

    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (!hostname) {
      return false;
    }

    // Block obvious local, container, and loopback identifiers
    const blockedExact = [
      'localhost',
      '127.0.0.1',
      '0.0.0.0',
      '::1',
      '::',
      'db',
      'postgres',
      'redis',
      'api',
      'worker',
      'frontend',
      'sentinel_db',
    ];

    if (blockedExact.includes(hostname)) {
      return false;
    }

    // Block private and link-local IPv4 prefixes
    if (
      hostname.startsWith('127.') ||
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('169.254.') ||
      hostname.startsWith('0.')
    ) {
      return false;
    }

    // 172.16.0.0 - 172.31.255.255 (RFC 1918)
    const match172 = hostname.match(/^172\.(\d{1,3})\./);
    if (match172) {
      const secondOctet = parseInt(match172[1], 10);
      if (secondOctet >= 16 && secondOctet <= 31) {
        return false;
      }
    }

    return true;
  }

  defaultMessage(_args: ValidationArguments): string {
    return 'target must be a valid public HTTP or HTTPS URL and cannot target localhost or private IP addresses';
  }
}

export function IsValidTarget(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsValidTargetConstraint,
    });
  };
}

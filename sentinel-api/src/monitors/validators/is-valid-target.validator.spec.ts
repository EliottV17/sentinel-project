import { validate } from 'class-validator';
import { CreateMonitorDto } from '../dto/create-monitor.dto';

describe('IsValidTarget Validator', () => {
  const createDto = (target: string) => {
    const dto = new CreateMonitorDto();
    dto.name = 'Test Monitor';
    dto.target = target;
    dto.frequency = 60;
    return dto;
  };

  it('accepts valid public HTTP and HTTPS URLs', async () => {
    const validTargets = [
      'https://google.com',
      'https://api.github.com/status',
      'http://example.com:8080/health',
      'https://my-portfolio.dev',
    ];

    for (const target of validTargets) {
      const dto = createDto(target);
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    }
  });

  it('rejects disallowed schemes', async () => {
    const invalidSchemes = [
      'ftp://example.com',
      'file:///etc/passwd',
      'gopher://example.com',
      'javascript:alert(1)',
      'not-a-url',
    ];

    for (const target of invalidSchemes) {
      const dto = createDto(target);
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('target');
    }
  });

  it('rejects obvious localhost, private IPs, and cloud metadata', async () => {
    const maliciousTargets = [
      'http://localhost:8000',
      'http://localhost/api',
      'http://127.0.0.1:8000',
      'http://127.0.0.1/status',
      'http://169.254.169.254/latest/meta-data',
      'http://10.0.0.1/admin',
      'http://192.168.1.1',
      'http://172.18.0.2:5432',
      'http://db:5432',
      'http://api:8000',
      'http://redis:6379',
    ];

    for (const target of maliciousTargets) {
      const dto = createDto(target);
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('target');
    }
  });
});

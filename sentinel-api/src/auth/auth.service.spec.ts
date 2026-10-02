import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let usersService: {
    findByEmail: jest.Mock;
    findByUsername: jest.Mock;
  };
  let jwtService: {
    signAsync: jest.Mock;
  };
  let configService: {
    get: jest.Mock;
  };

  beforeEach(async () => {
    usersService = {
      findByEmail: jest.fn(),
      findByUsername: jest.fn(),
    };
    jwtService = {
      signAsync: jest.fn(),
    };
    configService = {
      get: jest.fn().mockImplementation((key, defaultVal) => defaultVal),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('demoLogin', () => {
    it('uses the configured demo user and signs a 15-minute demo token despite arbitrary input', async () => {
      configService.get.mockImplementation((key, fallback) => key === 'DEMO_USER_EMAIL' ? 'demo@sentinel.com' : key === 'DEMO_ACCESS_TOKEN_EXPIRE_MINUTES' ? 15 : key === 'ACCESS_TOKEN_EXPIRE_MINUTES' ? 60 : fallback);
      usersService.findByEmail.mockResolvedValue({ id: 7, email: 'demo@sentinel.com', is_demo: true, is_active: true });
      jwtService.signAsync.mockResolvedValue('demo.jwt');
      const result = await (service as any).demoLogin({ email: 'attacker@sentinel.com' });
      expect(result.access_token).toBe('demo.jwt');
      expect(usersService.findByEmail).toHaveBeenCalledWith('demo@sentinel.com');
      expect(usersService.findByEmail).not.toHaveBeenCalledWith('attacker@sentinel.com');
      expect(jwtService.signAsync).toHaveBeenCalledWith({ sub: 'demo@sentinel.com', is_demo: true }, { expiresIn: '15m' });
    });

    it.each([
      [{ id: 8, email: 'demo@sentinel.com', is_active: false, is_demo: true }],
      [{ id: 8, email: 'demo@sentinel.com', is_active: true, is_demo: false }],
    ])('returns 503 for inactive or non-demo configured accounts', async (account) => {
      configService.get.mockImplementation((key, fallback) => key === 'DEMO_USER_EMAIL' ? 'demo@sentinel.com' : fallback);
      usersService.findByEmail.mockResolvedValue(account);
      await expect((service as any).demoLogin()).rejects.toThrow(ServiceUnavailableException);
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it.each([undefined, ''])('returns 503 and does not create an account when DEMO_USER_EMAIL is unset (%s)', async (email) => {
      configService.get.mockImplementation((key, fallback) => key === 'DEMO_USER_EMAIL' ? email : fallback);
      await expect((service as any).demoLogin()).rejects.toThrow(ServiceUnavailableException);
      expect(usersService.findByEmail).not.toHaveBeenCalled();
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it('returns 503 and does not create an account if the configured user is missing', async () => {
      configService.get.mockImplementation((key, fallback) => key === 'DEMO_USER_EMAIL' ? 'missing@sentinel.com' : fallback);
      usersService.findByEmail.mockResolvedValue(null);
      await expect((service as any).demoLogin()).rejects.toThrow(ServiceUnavailableException);
      expect(usersService.findByEmail).toHaveBeenCalledWith('missing@sentinel.com');
      expect(usersService).not.toHaveProperty('create');
    });
  });

  describe('login', () => {
    it('should return token when password matches with email', async () => {
      const hashedPassword = await argon2.hash('superpassword123');
      usersService.findByEmail.mockResolvedValue({
        id: 1,
        email: 'test@sentinel.com',
        username: 'testuser',
        password: hashedPassword,
      });
      jwtService.signAsync.mockResolvedValue('mocked.jwt.token');

      const result = await service.login('test@sentinel.com', 'superpassword123');

      expect(result).toEqual({
        access_token: 'mocked.jwt.token',
        token_type: 'bearer',
      });
      expect(jwtService.signAsync).toHaveBeenCalledWith(
        { sub: 'test@sentinel.com' },
        { expiresIn: '30m' },
      );
    });

    it('marks a demo account in regular password-login claims', async () => {
      const hashedPassword = await argon2.hash('superpassword123');
      configService.get.mockImplementation((key, fallback) => key === 'DEMO_ACCESS_TOKEN_EXPIRE_MINUTES' ? 15 : key === 'ACCESS_TOKEN_EXPIRE_MINUTES' ? 30 : fallback);
      usersService.findByEmail.mockResolvedValue({ id: 1, email: 'demo@sentinel.com', password: hashedPassword, is_demo: true });
      jwtService.signAsync.mockResolvedValue('demo.jwt');
      await service.login('demo@sentinel.com', 'superpassword123');
      expect(jwtService.signAsync).toHaveBeenCalledWith(
        { sub: 'demo@sentinel.com', is_demo: true }, { expiresIn: '15m' },
      );
    });

    it('should return token when password matches with username', async () => {
      const hashedPassword = await argon2.hash('superpassword123');
      usersService.findByEmail.mockResolvedValue(null);
      usersService.findByUsername.mockResolvedValue({
        id: 1,
        email: 'test@sentinel.com',
        username: 'testuser',
        password: hashedPassword,
      });
      jwtService.signAsync.mockResolvedValue('mocked.jwt.token');

      const result = await service.login('testuser', 'superpassword123');

      expect(result).toEqual({
        access_token: 'mocked.jwt.token',
        token_type: 'bearer',
      });
    });

    it('should throw UnauthorizedException when password is incorrect', async () => {
      const hashedPassword = await argon2.hash('correct_password');
      usersService.findByEmail.mockResolvedValue({
        id: 1,
        email: 'test@sentinel.com',
        username: 'testuser',
        password: hashedPassword,
      });

      await expect(
        service.login('test@sentinel.com', 'wrong_password'),
      ).rejects.toThrow(
        new UnauthorizedException('Incorrect username or password'),
      );
    });

    it('should throw UnauthorizedException when user does not exist', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      usersService.findByUsername.mockResolvedValue(null);

      await expect(
        service.login('nonexistent@sentinel.com', 'some_password'),
      ).rejects.toThrow(
        new UnauthorizedException('Incorrect username or password'),
      );
    });
  });
});

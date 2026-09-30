import { UnauthorizedException } from '@nestjs/common';
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

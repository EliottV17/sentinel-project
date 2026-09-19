import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: {
    users: {
      findUnique: jest.Mock;
      create: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      users: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should successfully create a new user with hashed password', async () => {
      prisma.users.findUnique.mockResolvedValue(null);
      prisma.users.create.mockImplementation(({ data }) => ({
        id: 1,
        ...data,
      }));

      const dto = {
        name: 'Test',
        last_name: 'User',
        username: 'testuser',
        email: 'test@sentinel.com',
        password: 'superpassword123',
      };

      const result = await service.create(dto);

      expect(result.id).toBe(1);
      expect(result.email).toBe('test@sentinel.com');
      expect(result.username).toBe('testuser');
      expect(prisma.users.create).toHaveBeenCalled();

      const createdArg = prisma.users.create.mock.calls[0][0].data;
      expect(createdArg.password).not.toBe('superpassword123');
      const isMatch = await argon2.verify(createdArg.password, 'superpassword123');
      expect(isMatch).toBe(true);
    });

    it('should throw BadRequestException when email already registered', async () => {
      prisma.users.findUnique.mockImplementation(({ where }) => {
        if (where.email) return { id: 1, email: 'test@sentinel.com' };
        return null;
      });

      const dto = {
        name: 'Test',
        last_name: 'User',
        username: 'testuser',
        email: 'test@sentinel.com',
        password: 'superpassword123',
      };

      await expect(service.create(dto)).rejects.toThrow(
        new BadRequestException('Email already registered'),
      );
    });

    it('should throw BadRequestException when username already taken', async () => {
      prisma.users.findUnique.mockImplementation(({ where }) => {
        if (where.username) return { id: 1, username: 'testuser' };
        return null;
      });

      const dto = {
        name: 'Test',
        last_name: 'User',
        username: 'testuser',
        email: 'test2@sentinel.com',
        password: 'superpassword123',
      };

      await expect(service.create(dto)).rejects.toThrow(
        new BadRequestException('Username already taken'),
      );
    });
  });
});

import { BadRequestException, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UserResponseDto } from './dto/user-response.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findByEmail(email: string) {
    return this.prisma.users.findUnique({
      where: { email },
    });
  }

  async findByUsername(username: string) {
    return this.prisma.users.findUnique({
      where: { username },
    });
  }

  async findById(id: number) {
    return this.prisma.users.findUnique({
      where: { id },
    });
  }

  async create(createUserDto: CreateUserDto): Promise<UserResponseDto> {
    const existingEmail = await this.findByEmail(createUserDto.email);
    if (existingEmail) {
      throw new BadRequestException('Email already registered');
    }

    const existingUsername = await this.findByUsername(createUserDto.username);
    if (existingUsername) {
      throw new BadRequestException('Username already taken');
    }

    const hashedPassword = await argon2.hash(createUserDto.password);
    const now = new Date();

    const user = await this.prisma.users.create({
      data: {
        name: createUserDto.name,
        last_name: createUserDto.last_name,
        username: createUserDto.username,
        email: createUserDto.email,
        password: hashedPassword,
        phonenumber: createUserDto.phonenumber ?? null,
        created_at: now,
        updated_at: now,
        status: 'Active',
        is_active: true,
      },
    });

    return UserResponseDto.fromEntity(user);
  }
}

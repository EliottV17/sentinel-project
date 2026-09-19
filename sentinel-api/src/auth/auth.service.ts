import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { UsersService } from '../users/users.service';
import { TokenDto } from './dto/token.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async authenticateUser(loginIdentifier: string, pass: string) {
    let user = await this.usersService.findByEmail(loginIdentifier);
    if (!user) {
      user = await this.usersService.findByUsername(loginIdentifier);
    }

    if (!user) {
      return null;
    }

    try {
      const isPasswordValid = await argon2.verify(user.password, pass);
      if (!isPasswordValid) {
        return null;
      }
    } catch {
      return null;
    }

    return user;
  }

  async login(loginIdentifier: string, pass: string): Promise<TokenDto> {
    const user = await this.authenticateUser(loginIdentifier, pass);
    if (!user) {
      throw new UnauthorizedException('Incorrect username or password');
    }

    const payload = { sub: user.email };
    const expireMinutes = this.configService.get<number>(
      'ACCESS_TOKEN_EXPIRE_MINUTES',
      30,
    );
    const expiresIn = `${expireMinutes}m`;

    const token = await this.jwtService.signAsync(payload, { expiresIn });
    return {
      access_token: token,
      token_type: 'bearer',
    };
  }
}

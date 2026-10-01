import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsersService } from '../../users/users.service';
import { validateSecretKey } from '../utils/secret-validator';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: validateSecretKey(configService),
    });
  }

  async validate(payload: { sub: string }) {
    if (!payload || !payload.sub) {
      throw new UnauthorizedException('Could not validate credentials');
    }

    const user = await this.usersService.findByEmail(payload.sub);
    if (!user) {
      throw new UnauthorizedException('Could not validate credentials');
    }

    if (!user.is_active) {
      throw new BadRequestException('Inactive user');
    }

    return user;
  }
}

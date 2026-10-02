import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { TokenDto } from './dto/token.dto';
import { Public } from '../common/decorators/public.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('demo-login')
  @Public()
  @Throttle({ auth: { limit: 30, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  async demoLogin(): Promise<TokenDto> {
    return this.authService.demoLogin();
  }

  @Post('login')
  @Public()
  @Throttle({ auth: { limit: 5, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto): Promise<TokenDto> {
    return this.authService.login(loginDto.username, loginDto.password);
  }
}

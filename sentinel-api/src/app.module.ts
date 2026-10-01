import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { MonitorsModule } from './monitors/monitors.module';
import { AppController } from './app.controller';
import { AppThrottlerGuard } from './common/guards/app-throttler.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../.env'],
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => [
        {
          name: 'default',
          ttl: configService.get<number>('THROTTLE_DEFAULT_TTL', 60000),
          limit: configService.get<number>('THROTTLE_DEFAULT_LIMIT', 100),
        },
        {
          name: 'auth',
          ttl: configService.get<number>('THROTTLE_AUTH_TTL', 60000),
          limit: configService.get<number>('THROTTLE_AUTH_LIMIT', 5),
        },
        {
          name: 'monitors',
          ttl: configService.get<number>('THROTTLE_MONITORS_TTL', 60000),
          limit: configService.get<number>('THROTTLE_MONITORS_LIMIT', 20),
        },
      ],
    }),
    PrismaModule,
    UsersModule,
    AuthModule,
    MonitorsModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AppThrottlerGuard,
    },
  ],
})
export class AppModule {}

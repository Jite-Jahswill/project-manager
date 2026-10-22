import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DeviceTokenService } from './device-token.service';
import { DefaultRateLimitGuard, RouteRateLimitGuard } from './rate-limit.guard';
import { RateLimiter } from './rate-limiter.service';
import { RedisService } from './redis.service';

@Global()
@Module({
  providers: [RedisService, RateLimiter, DeviceTokenService, RouteRateLimitGuard, { provide: APP_GUARD, useClass: DefaultRateLimitGuard }],
  exports: [RedisService, RateLimiter, DeviceTokenService, RouteRateLimitGuard],
})
export class AbuseModule {}

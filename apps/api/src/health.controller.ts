import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from './auth/decorators';
import { PrismaService } from './database/prisma.service';
import { RedisService } from './abuse/redis.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * PostgreSQL is required (503 if down). Redis is reported but does not fail the
   * check: with Redis down, fail-open routes and existing sessions still work, and
   * taking every instance out of rotation would turn a partial outage into a full one.
   */
  @Public() @Get() @HttpCode(HttpStatus.OK)
  async check(@Res({ passthrough: true }) res: Response) {
    let database = 'up';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'down';
    }
    const redis = (await this.redis.ping()) ? 'up' : 'down';
    if (database === 'down') res.status(HttpStatus.SERVICE_UNAVAILABLE);
    // Component states only; limiter counters stay in internal logs (this route is public).
    return { status: database === 'down' ? 'down' : redis === 'down' ? 'degraded' : 'ok', database, redis };
  }
}

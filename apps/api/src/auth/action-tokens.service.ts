import { Injectable } from '@nestjs/common';
import { UserActionPurpose } from '../generated/prisma/client';
import { hashToken, randomToken } from '../common/crypto';
import { Errors } from '../common/errors';
import { PrismaService } from '../database/prisma.service';

export const ACTION_TOKEN_TTL_MS: Record<UserActionPurpose, number> = {
  EMAIL_VERIFICATION: 24 * 60 * 60_000,
  PASSWORD_RESET: 60 * 60_000,
};

/**
 * Single-use account tokens (email verification, password reset). Owned by the auth
 * subsystem: the email worker asks for a token at send time; templates never create
 * or validate tokens. Only SHA-256 hashes are stored; only the newest token of each
 * purpose is valid; consumption is a conditional update (single use under concurrency).
 */
@Injectable()
export class ActionTokenService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, purpose: UserActionPurpose): Promise<string> {
    const token = randomToken();
    await this.prisma.$transaction([
      this.prisma.userActionToken.updateMany({ where: { userId, purpose, consumedAt: null }, data: { consumedAt: new Date() } }),
      this.prisma.userActionToken.create({
        data: { userId, purpose, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + ACTION_TOKEN_TTL_MS[purpose]) },
      }),
    ]);
    return token;
  }

  /** True if this exact token is still the user's newest unconsumed, unexpired token. */
  async isCurrent(userId: string, purpose: UserActionPurpose, token: string): Promise<boolean> {
    const row = await this.prisma.userActionToken.findUnique({ where: { tokenHash: hashToken(token) }, select: { userId: true, purpose: true, consumedAt: true, expiresAt: true } });
    return !!row && row.userId === userId && row.purpose === purpose && !row.consumedAt && row.expiresAt > new Date();
  }

  async consume(token: string, purpose: UserActionPurpose): Promise<string> {
    const now = new Date();
    const record = await this.prisma.userActionToken.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!record || record.purpose !== purpose || record.consumedAt || record.expiresAt <= now) {
      throw Errors.badRequest('invalid_token', 'The link is invalid or has expired');
    }
    const claimed = await this.prisma.userActionToken.updateMany({ where: { id: record.id, consumedAt: null }, data: { consumedAt: now } });
    if (claimed.count !== 1) throw Errors.badRequest('invalid_token', 'The link is invalid or has expired');
    return record.userId;
  }
}

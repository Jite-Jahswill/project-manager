import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { APP_CONFIG, AppConfig } from '../config/env';
import { PrismaService } from '../database/prisma.service';
import { randomToken } from '../common/crypto';
import { Errors } from '../common/errors';
import { Auth, AuthIdentity, Meta, RequestMeta, VentidocRequest } from '../common/request-context';
import { AuthService, IssuedTokens } from './auth.service';
import { assertCsrf } from './auth.guard';
import { clearAuthCookies, DEVICE_COOKIE, REFRESH_COOKIE, setAuthCookies, setDeviceCookie } from './cookies';
import { Public } from './decorators';
import { RateLimit } from '../abuse/rate-limit.guard';
import { EmailDto, LoginDto, ReauthenticateDto, RefreshDto, RegisterDto, ResetPasswordDto, TokenDto } from './dto/auth.dto';

const ACCEPTED = { status: 'accepted' } as const;

@ApiTags('auth')
@Controller('v1/auth')
export class AuthController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  @Public() @RateLimit('register.ip', 'ip') @RateLimit('register.email', 'email') @Post('register') @HttpCode(202)
  async register(@Body() dto: RegisterDto, @Meta() meta: RequestMeta) {
    await this.auth.register(dto, meta);
    return ACCEPTED;
  }

  @Public() @RateLimit('verify_email.ip', 'ip') @Post('verify-email') @HttpCode(200)
  async verifyEmail(@Body() dto: TokenDto, @Meta() meta: RequestMeta) {
    await this.auth.verifyEmail(dto.token, meta);
    return { status: 'verified' };
  }

  @Public() @RateLimit('resend_verification.ip', 'ip') @RateLimit('resend_verification.email', 'email') @Post('verify-email/resend') @HttpCode(202)
  async resend(@Body() dto: EmailDto) {
    await this.auth.resendVerification(dto.email);
    return ACCEPTED;
  }

  /** Limits (login.*) are applied inside AuthService.login, which needs the account and device context. */
  @Public() @Post('login') @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: VentidocRequest, @Meta() meta: RequestMeta, @Res({ passthrough: true }) res: Response) {
    const deviceToken = dto.clientType === 'WEB' ? (req.cookies?.[DEVICE_COOKIE] as string | undefined) : dto.deviceToken;
    const result = await this.auth.login({ ...dto, deviceToken }, meta);
    if (dto.clientType === 'WEB') {
      setDeviceCookie(res, this.config, result.deviceToken);
      return { user: result.user, ...this.deliver('WEB', result, res) };
    }
    return { user: result.user, ...this.deliver('MOBILE', result, res), deviceToken: result.deviceToken };
  }

  @Public() @RateLimit('refresh.ip', 'ip') @Post('refresh') @HttpCode(200)
  async refresh(@Body() dto: RefreshDto, @Req() req: VentidocRequest, @Meta() meta: RequestMeta, @Res({ passthrough: true }) res: Response) {
    if (dto.refreshToken) return this.deliver('MOBILE', await this.auth.refresh(dto.refreshToken, meta), res);
    const cookie = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (!cookie) throw Errors.unauthenticated();
    assertCsrf(req);
    return this.deliver('WEB', await this.auth.refresh(cookie, meta), res);
  }

  @Post('logout') @HttpCode(204)
  async logout(@Auth() identity: AuthIdentity, @Meta() meta: RequestMeta, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(identity.sessionId, identity.userId, meta);
    clearAuthCookies(res, this.config);
  }

  @Post('reauthenticate') @RateLimit('reauth.session', 'session') @RateLimit('reauth.user', 'user') @HttpCode(204)
  async reauthenticate(@Auth() identity: AuthIdentity, @Body() dto: ReauthenticateDto, @Meta() meta: RequestMeta) {
    await this.auth.reauthenticate(identity.userId, identity.sessionId, dto.password, meta);
  }

  @Public() @RateLimit('forgot.ip', 'ip') @RateLimit('forgot.email', 'email') @Post('password/forgot') @HttpCode(202)
  async forgot(@Body() dto: EmailDto, @Meta() meta: RequestMeta) {
    await this.auth.forgotPassword(dto.email, meta);
    return ACCEPTED;
  }

  @Public() @RateLimit('reset.ip', 'ip') @Post('password/reset') @HttpCode(204)
  async reset(@Body() dto: ResetPasswordDto, @Meta() meta: RequestMeta) {
    await this.auth.resetPassword(dto.token, dto.newPassword, meta);
  }

  @Get('me')
  async me(@Auth() identity: AuthIdentity) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: identity.userId },
      select: { id: true, email: true, displayName: true, emailVerifiedAt: true, createdAt: true },
    });
    return { ...user, sessionId: identity.sessionId };
  }

  @Get('sessions')
  async sessions(@Auth() identity: AuthIdentity) {
    const sessions = await this.auth.listSessions(identity.userId);
    return sessions.map((s) => ({ ...s, current: s.id === identity.sessionId }));
  }

  @Delete('sessions/:sessionId') @HttpCode(204)
  async revoke(@Auth() identity: AuthIdentity, @Param('sessionId', ParseUUIDPipe) sessionId: string, @Meta() meta: RequestMeta) {
    await this.auth.revokeOwnSession(identity.userId, sessionId, meta);
  }

  /** Web: tokens go into HTTP-only cookies and never into the JSON body. Mobile: body only. */
  private deliver(clientType: 'WEB' | 'MOBILE', tokens: IssuedTokens, res: Response) {
    const common = { sessionId: tokens.sessionId, accessTokenExpiresAt: tokens.accessTokenExpiresAt };
    if (clientType === 'WEB') {
      setAuthCookies(res, this.config, {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        csrfToken: randomToken(),
        refreshExpiresAt: tokens.refreshTokenExpiresAt,
      });
      return common;
    }
    return {
      ...common,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
    };
  }
}

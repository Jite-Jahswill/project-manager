import { Body, Controller, Delete, Get, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RateLimit } from '../abuse/rate-limit.guard';
import { AllowWithoutMfa } from '../auth/decorators';
import { Auth, AuthIdentity, Meta, RequestMeta } from '../common/request-context';
import { ConfirmEnrollmentDto, ManageMfaDto, SecondFactorDto } from './dto/mfa.dto';
import { MfaService } from './mfa.service';

/**
 * MFA self-service. Enrollment routes are reachable before MFA is set up (that is
 * how mandatory users comply); management routes require an MFA-verified session.
 */
@ApiTags('mfa')
@Controller('v1/auth/mfa')
export class MfaController {
  constructor(private readonly mfa: MfaService) {}

  @Get() @AllowWithoutMfa()
  status(@Auth() identity: AuthIdentity) {
    return this.mfa.status(identity);
  }

  @Post('enrollment') @AllowWithoutMfa() @RateLimit('mfa.enroll.user', 'user') @HttpCode(200)
  start(@Auth() identity: AuthIdentity, @Body() dto: SecondFactorDto, @Meta() meta: RequestMeta) {
    return this.mfa.startEnrollment(identity, dto, meta);
  }

  @Post('enrollment/confirm') @AllowWithoutMfa() @RateLimit('mfa.enroll.user', 'user') @HttpCode(200)
  confirm(@Auth() identity: AuthIdentity, @Body() dto: ConfirmEnrollmentDto, @Meta() meta: RequestMeta) {
    return this.mfa.confirmEnrollment(identity, dto, meta);
  }

  @Delete('enrollment') @AllowWithoutMfa() @HttpCode(204)
  cancel(@Auth() identity: AuthIdentity) {
    return this.mfa.cancelEnrollment(identity);
  }

  @Post('recovery-codes') @RateLimit('mfa.manage.user', 'user') @HttpCode(200)
  regenerate(@Auth() identity: AuthIdentity, @Body() dto: ManageMfaDto, @Meta() meta: RequestMeta) {
    return this.mfa.regenerateRecoveryCodes(identity, dto, meta);
  }

  @Post('disable') @RateLimit('mfa.manage.user', 'user') @HttpCode(204)
  disable(@Auth() identity: AuthIdentity, @Body() dto: ManageMfaDto, @Meta() meta: RequestMeta) {
    return this.mfa.disable(identity, dto, meta);
  }
}

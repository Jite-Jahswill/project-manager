import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Auth, AuthIdentity, Meta, RequestMeta } from '../common/request-context';
import { RequirePlatformPermission } from '../authz/platform-access.guard';
import { EmailAdminService } from './email-admin.service';
import {
  AttestDomainDto, CreateProviderDto, ListDeliveriesQuery, PreviewTemplateDto, SenderIdentityDto, SetSecretDto, SetSendingDto,
  SuppressionDto, TemplateVersionDto, TestSendDto, UpdateEmailSettingsDto, UpdateProviderDto, UpdateSenderIdentityDto,
} from './dto/email-admin.dto';

/**
 * Email configuration for platform administrators (docs/security/email.md §3). Every
 * route requires an MFA-verified platform session; privileged permissions also require
 * a password re-entry within 10 minutes and are rate-limited per administrator.
 */
@ApiTags('platform-email')
@Controller('v1/platform/email')
export class EmailAdminController {
  constructor(private readonly email: EmailAdminService) {}

  @Get('config') @RequirePlatformPermission('platform.email.read')
  config(@Auth() a: AuthIdentity) {
    return this.email.getConfiguration(a.userId);
  }

  @Patch('settings') @RequirePlatformPermission('platform.email.configure')
  updateSettings(@Auth() a: AuthIdentity, @Body() dto: UpdateEmailSettingsDto, @Meta() m: RequestMeta) {
    return this.email.updateSettings(a.userId, dto, m);
  }

  @Post('sending') @HttpCode(200) @RequirePlatformPermission('platform.email.configure')
  setSending(@Auth() a: AuthIdentity, @Body() dto: SetSendingDto, @Meta() m: RequestMeta) {
    return this.email.setSending(a.userId, dto.enabled, m);
  }

  @Post('providers') @RequirePlatformPermission('platform.email.configure')
  createProvider(@Auth() a: AuthIdentity, @Body() dto: CreateProviderDto, @Meta() m: RequestMeta) {
    return this.email.createProvider(a.userId, dto, m);
  }

  @Patch('providers/:providerId') @RequirePlatformPermission('platform.email.configure')
  updateProvider(@Auth() a: AuthIdentity, @Param('providerId', ParseUUIDPipe) id: string, @Body() dto: UpdateProviderDto, @Meta() m: RequestMeta) {
    return this.email.updateProvider(a.userId, id, dto, m);
  }

  @Post('providers/:providerId/activate') @HttpCode(200) @RequirePlatformPermission('platform.email.configure')
  activate(@Auth() a: AuthIdentity, @Param('providerId', ParseUUIDPipe) id: string, @Meta() m: RequestMeta) {
    return this.email.activateProvider(a.userId, id, m);
  }

  @Post('providers/:providerId/check') @HttpCode(200) @RequirePlatformPermission('platform.email.configure')
  check(@Auth() a: AuthIdentity, @Param('providerId', ParseUUIDPipe) id: string, @Meta() m: RequestMeta) {
    return this.email.checkProvider(a.userId, id, m);
  }

  @Put('providers/:providerId/secret') @RequirePlatformPermission('platform.email.secrets.manage')
  setSecret(@Auth() a: AuthIdentity, @Param('providerId', ParseUUIDPipe) id: string, @Body() dto: SetSecretDto, @Meta() m: RequestMeta) {
    return this.email.setSecret(a.userId, id, dto.secret, m);
  }

  @Delete('providers/:providerId/secret') @RequirePlatformPermission('platform.email.secrets.manage')
  clearSecret(@Auth() a: AuthIdentity, @Param('providerId', ParseUUIDPipe) id: string, @Meta() m: RequestMeta) {
    return this.email.clearSecret(a.userId, id, m);
  }

  @Post('sender-identities') @RequirePlatformPermission('platform.email.configure')
  createSender(@Auth() a: AuthIdentity, @Body() dto: SenderIdentityDto, @Meta() m: RequestMeta) {
    return this.email.createSenderIdentity(a.userId, dto, m);
  }

  @Patch('sender-identities/:identityId') @RequirePlatformPermission('platform.email.configure')
  updateSender(@Auth() a: AuthIdentity, @Param('identityId', ParseUUIDPipe) id: string, @Body() dto: UpdateSenderIdentityDto, @Meta() m: RequestMeta) {
    return this.email.updateSenderIdentity(a.userId, id, dto, m);
  }

  @Post('sender-identities/:identityId/attest-domain') @HttpCode(200) @RequirePlatformPermission('platform.email.configure')
  attest(@Auth() a: AuthIdentity, @Param('identityId', ParseUUIDPipe) id: string, @Body() dto: AttestDomainDto, @Meta() m: RequestMeta) {
    return this.email.attestDomain(a.userId, id, dto.statement, m);
  }

  @Get('templates') @RequirePlatformPermission('platform.email.read')
  templates(@Auth() a: AuthIdentity) {
    return this.email.listTemplates(a.userId);
  }

  @Get('templates/:key/versions/:version') @RequirePlatformPermission('platform.email.read')
  templateVersion(@Auth() a: AuthIdentity, @Param('key') key: string, @Param('version', ParseIntPipe) version: number) {
    return this.email.getTemplateVersion(a.userId, key, version);
  }

  @Post('templates/:key/versions') @RequirePlatformPermission('platform.email.templates.manage')
  createVersion(@Auth() a: AuthIdentity, @Param('key') key: string, @Body() dto: TemplateVersionDto, @Meta() m: RequestMeta) {
    return this.email.createTemplateVersion(a.userId, key, dto, m);
  }

  @Post('templates/:key/versions/:version/activate') @HttpCode(200) @RequirePlatformPermission('platform.email.templates.manage')
  activateVersion(@Auth() a: AuthIdentity, @Param('key') key: string, @Param('version', ParseIntPipe) version: number, @Meta() m: RequestMeta) {
    return this.email.activateTemplateVersion(a.userId, key, version, m);
  }

  @Post('templates/:key/preview') @HttpCode(200) @RequirePlatformPermission('platform.email.read')
  preview(@Auth() a: AuthIdentity, @Param('key') key: string, @Body() dto: PreviewTemplateDto) {
    return this.email.previewTemplate(a.userId, key, dto);
  }

  @Post('test-send') @HttpCode(202) @RequirePlatformPermission('platform.email.test_send')
  testSend(@Auth() a: AuthIdentity, @Body() dto: TestSendDto, @Meta() m: RequestMeta) {
    return this.email.testSend(a.userId, dto.to, m);
  }

  @Get('deliveries') @RequirePlatformPermission('platform.email.deliveries.read')
  deliveries(@Auth() a: AuthIdentity, @Query() q: ListDeliveriesQuery) {
    return this.email.listDeliveries(a.userId, q.status, q.limit);
  }

  @Get('deliveries/:deliveryId') @RequirePlatformPermission('platform.email.deliveries.read')
  delivery(@Auth() a: AuthIdentity, @Param('deliveryId', ParseUUIDPipe) id: string) {
    return this.email.getDelivery(a.userId, id);
  }

  @Post('deliveries/:deliveryId/retry') @HttpCode(200) @RequirePlatformPermission('platform.email.deliveries.manage')
  retry(@Auth() a: AuthIdentity, @Param('deliveryId', ParseUUIDPipe) id: string, @Meta() m: RequestMeta) {
    return this.email.retryDelivery(a.userId, id, m);
  }

  @Post('deliveries/:deliveryId/cancel') @HttpCode(204) @RequirePlatformPermission('platform.email.deliveries.manage')
  cancel(@Auth() a: AuthIdentity, @Param('deliveryId', ParseUUIDPipe) id: string, @Meta() m: RequestMeta) {
    return this.email.cancelDelivery(a.userId, id, m);
  }

  @Get('metrics') @RequirePlatformPermission('platform.email.deliveries.read')
  metrics(@Auth() a: AuthIdentity) {
    return this.email.metrics(a.userId);
  }

  @Get('suppressions') @RequirePlatformPermission('platform.email.deliveries.read')
  suppressions(@Auth() a: AuthIdentity) {
    return this.email.listSuppressions(a.userId);
  }

  @Post('suppressions') @RequirePlatformPermission('platform.email.deliveries.manage')
  addSuppression(@Auth() a: AuthIdentity, @Body() dto: SuppressionDto, @Meta() m: RequestMeta) {
    return this.email.addSuppression(a.userId, dto, m);
  }

  @Delete('suppressions/:suppressionId') @HttpCode(204) @RequirePlatformPermission('platform.email.deliveries.manage')
  removeSuppression(@Auth() a: AuthIdentity, @Param('suppressionId', ParseUUIDPipe) id: string, @Meta() m: RequestMeta) {
    return this.email.removeSuppression(a.userId, id, m);
  }

  @Get('audit-events') @RequirePlatformPermission('platform.email.read')
  audit(@Auth() a: AuthIdentity) {
    return this.email.auditHistory(a.userId);
  }
}

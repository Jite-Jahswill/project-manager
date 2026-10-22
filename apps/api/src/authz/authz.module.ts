import { Global, Module } from '@nestjs/common';
import { OrgAccessGuard } from './org-access.guard';
import { OrgAuthzService } from './org-authz.service';
import { PlatformAccessGuard } from './platform-access.guard';
import { PermissionsController } from './permissions.controller';
import { PlatformAuthzService } from './platform-authz.service';

@Global()
@Module({
  controllers: [PermissionsController],
  providers: [OrgAuthzService, OrgAccessGuard, PlatformAuthzService, PlatformAccessGuard],
  exports: [OrgAuthzService, OrgAccessGuard, PlatformAuthzService, PlatformAccessGuard],
})
export class AuthzModule {}

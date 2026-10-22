import { Module } from '@nestjs/common';
import { AccessControlService } from './access-control.service';
import { OrganizationsController, OrganizationScopedController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';

@Module({
  controllers: [OrganizationsController, OrganizationScopedController],
  providers: [OrganizationsService, AccessControlService],
})
export class OrganizationsModule {}

import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { describeKey, PERMISSIONS } from './permission-registry';
import { ROLE_TEMPLATES } from './role-templates';

/** The permission catalog, for building role editors. Not sensitive. */
@ApiTags('permissions')
@Controller('v1/permissions')
export class PermissionsController {
  @Get()
  list() {
    return {
      permissions: [...PERMISSIONS.values()].map((p) => ({ ...p, ...describeKey(p.key) })),
      roleTemplates: ROLE_TEMPLATES.map((t) => ({ key: t.key, name: t.name, description: t.description, permissions: t.permissions })),
    };
  }
}

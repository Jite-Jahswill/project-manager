import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'ventidoc:isPublic';
/** Route needs no authenticated session (login, register, password reset, health). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

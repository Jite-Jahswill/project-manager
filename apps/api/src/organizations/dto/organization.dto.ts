import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsDateString, IsEmail, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches,
  Max, MaxLength, Min, ValidateNested,
} from 'class-validator';

export class CreateOrganizationDto {
  @ApiProperty() @IsString() @Length(2, 120) name!: string;
  @ApiProperty({ example: 'acme-traders' }) @Matches(/^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/) slug!: string;
  @ApiPropertyOptional({ example: 'NGN' }) @IsOptional() @Matches(/^[A-Z]{3}$/) defaultCurrency?: string;
}

export class CreateBranchDto {
  @ApiProperty() @IsString() @Length(1, 120) name!: string;
  @ApiProperty({ example: 'LAG-01' }) @Matches(/^[A-Z0-9-]{1,20}$/) code!: string;
}

export class InviteMemberDto {
  @ApiProperty() @IsEmail() @MaxLength(254) email!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() roleId?: string;
  @ApiPropertyOptional({ description: 'Assign the role at this branch only' }) @IsOptional() @IsUUID() branchId?: string;
}

export class AcceptInvitationDto {
  @ApiProperty() @IsString() @Length(20, 300) token!: string;
}

export class UpdateMembershipStatusDto {
  @ApiProperty({ enum: ['ACTIVE', 'SUSPENDED', 'REVOKED'] }) @IsIn(['ACTIVE', 'SUSPENDED', 'REVOKED']) status!: 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
}

export class RoleAssignmentDto {
  @ApiProperty() @IsUUID() roleId!: string;
  @ApiPropertyOptional({ nullable: true, description: 'null/omitted = organization-wide' }) @IsOptional() @IsUUID() branchId?: string | null;
}

export class SetMemberRolesDto {
  @ApiProperty({ type: [RoleAssignmentDto] })
  @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => RoleAssignmentDto)
  assignments!: RoleAssignmentDto[];
}

export class CreateRoleDto {
  @ApiProperty() @IsString() @Length(1, 80) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(500) @IsString({ each: true }) permissions!: string[];
}

export class UpdateRoleDto {
  @ApiProperty({ description: 'The role version you edited (optimistic concurrency); a stale version gets 409 version_conflict' })
  @IsInt() @Min(1) version!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 80) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(500) @IsString({ each: true }) permissions?: string[];
}

export class DeleteRoleQuery {
  @ApiProperty({ description: 'The role version you saw (optimistic concurrency); a stale version gets 409 version_conflict' })
  @Type(() => Number) @IsInt() @Min(1) version!: number;
}

export class CloneRoleDto {
  @ApiProperty() @IsString() @Length(1, 80) name!: string;
}

export class CreateOverrideDto {
  @ApiProperty() @IsString() @MaxLength(100) permissionKey!: string;
  @ApiProperty({ enum: ['GRANT', 'DENY'] }) @IsEnum({ GRANT: 'GRANT', DENY: 'DENY' }) effect!: 'GRANT' | 'DENY';
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() expiresAt?: string;
}

export class AuditQueryDto {
  @ApiPropertyOptional({ default: 50 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @ApiPropertyOptional({ description: 'occurredAt of the last event from the previous page' }) @IsOptional() @IsDateString() before?: string;
}

export class UpdateOrganizationDto {
  @ApiProperty({ description: 'The version you saw (optimistic concurrency)' }) @IsInt() @Min(1) version!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 120) @Matches(/\S/) name?: string;
  @ApiPropertyOptional({ example: 'NGN', description: 'Default for new records only; existing amounts keep their own currency' })
  @IsOptional() @Matches(/^[A-Z]{3}$/) defaultCurrency?: string;
}

export class ListBranchesQuery {
  @ApiPropertyOptional({ enum: ['ACTIVE', 'ARCHIVED'] }) @IsOptional() @IsIn(['ACTIVE', 'ARCHIVED']) status?: 'ACTIVE' | 'ARCHIVED';
}

export class UpdateBranchDto {
  @ApiProperty({ description: 'The version you saw (optimistic concurrency)' }) @IsInt() @Min(1) version!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 120) @Matches(/\S/) name?: string;
  @ApiPropertyOptional({ example: 'LAG-01' }) @IsOptional() @Matches(/^[A-Z0-9-]{1,20}$/) code?: string;
}

export class BranchLifecycleDto {
  @ApiProperty({ description: 'The version you saw (optimistic concurrency)' }) @IsInt() @Min(1) version!: number;
}

export class ListInvitationsQuery {
  @ApiPropertyOptional({ enum: ['pending', 'expired'], default: 'pending' }) @IsOptional() @IsIn(['pending', 'expired']) status?: 'pending' | 'expired';
}

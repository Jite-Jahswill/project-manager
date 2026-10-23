import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min,
} from 'class-validator';

export class UpdateEmailSettingsDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() defaultSenderId?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(20) retryMaxAttempts?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(3600) retryBaseDelaySeconds?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(86400) retryMaxDelaySeconds?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(10000) maxSendsPerMinute?: number;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(20) @IsEmail({}, { each: true }) testRecipients?: string[];
}

export class SetSendingDto {
  @ApiProperty() @IsBoolean() enabled!: boolean;
}

export class CreateProviderDto {
  @ApiProperty({ enum: ['RESEND', 'SMTP', 'LOG', 'CAPTURE'] }) @IsIn(['RESEND', 'SMTP', 'LOG', 'CAPTURE']) kind!: 'RESEND' | 'SMTP' | 'LOG' | 'CAPTURE';
  @ApiProperty() @IsString() @Length(2, 60) name!: string;
  @ApiPropertyOptional({ description: 'Provider-specific, validated per provider' }) @IsOptional() @IsObject() settings?: Record<string, unknown>;
}

export class UpdateProviderDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 60) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() settings?: Record<string, unknown>;
}

export class SetSecretDto {
  @ApiProperty({ description: 'Write-only. Never returned.' }) @IsString() @Length(1, 500) secret!: string;
}

export class SenderIdentityDto {
  @ApiProperty() @IsEmail() @MaxLength(254) email!: string;
  @ApiProperty() @IsString() @Length(1, 80) displayName!: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() @MaxLength(254) replyTo?: string;
}

export class UpdateSenderIdentityDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 80) displayName?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsEmail() @MaxLength(254) replyTo?: string;
}

export class AttestDomainDto {
  @ApiProperty({ description: 'How SPF/DKIM/DMARC were verified for the SMTP sender domain' }) @IsString() @Length(10, 500) statement!: string;
}

export class TemplateVersionDto {
  @ApiProperty() @IsString() @Length(1, 200) subject!: string;
  @ApiProperty() @IsString() @Length(1, 50000) text!: string;
  @ApiProperty() @IsString() @Length(1, 50000) html!: string;
}

export class PreviewTemplateDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) version?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 200) subject?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 50000) text?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 50000) html?: string;
}

export class TestSendDto {
  @ApiProperty() @IsEmail() @MaxLength(254) to!: string;
}

export class ListDeliveriesQuery {
  @ApiPropertyOptional() @IsOptional() @IsIn(['PENDING', 'PROCESSING', 'SENT', 'FAILED', 'EXPIRED', 'DISCARDED', 'CANCELLED']) status?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}

export class SuppressionDto {
  @ApiProperty() @IsEmail() @MaxLength(254) email!: string;
  @ApiProperty({ enum: ['BOUNCE', 'COMPLAINT', 'MANUAL'] }) @IsIn(['BOUNCE', 'COMPLAINT', 'MANUAL']) reason!: 'BOUNCE' | 'COMPLAINT' | 'MANUAL';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) note?: string;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator';
import { PASSWORD_MAX } from '../../auth/dto/auth.dto';

export class SecondFactorDto {
  @ApiPropertyOptional({ description: '6-digit authenticator code' }) @IsOptional() @IsString() @MaxLength(16) code?: string;
  @ApiPropertyOptional({ description: 'Single-use recovery code' }) @IsOptional() @IsString() @MaxLength(40) recoveryCode?: string;
}

export class ConfirmEnrollmentDto {
  @ApiProperty({ description: '6-digit code from the newly added authenticator' }) @IsString() @MaxLength(16) code!: string;
  @ApiPropertyOptional({ description: 'Code emailed for a first enrollment' }) @IsOptional() @IsString() @MaxLength(16) emailCode?: string;
}

export class ManageMfaDto extends SecondFactorDto {
  @ApiProperty() @IsString() @Length(1, PASSWORD_MAX) password!: string;
}

export class MfaLoginDto extends SecondFactorDto {
  @ApiProperty({ description: 'mfaToken returned by POST /v1/auth/login' }) @IsString() @Length(20, 120) mfaToken!: string;
  @ApiPropertyOptional({ description: 'Mobile: recognized-client token (web uses a cookie)' }) @IsOptional() @IsString() @MaxLength(512) deviceToken?: string;
}

export class CreateMfaRecoveryRequestDto {
  @ApiProperty() @IsUUID() targetUserId!: string;
  @ApiProperty({ description: 'Ticket reference and the out-of-band identity verification performed' }) @IsString() @Length(10, 500) reason!: string;
}

export class ApproveMfaRecoveryDto {
  @ApiProperty({ description: 'The target user ID, re-entered by the approver after verifying it' }) @IsUUID() targetUserId!: string;
}

export class RejectMfaRecoveryDto {
  @ApiProperty() @IsString() @Length(3, 500) note!: string;
}

export class ListMfaRecoveryQuery {
  @ApiPropertyOptional({ enum: ['PENDING', 'APPROVED', 'EXECUTED', 'REJECTED', 'CANCELLED', 'EXPIRED'] })
  @IsOptional() @IsIn(['PENDING', 'APPROVED', 'EXECUTED', 'REJECTED', 'CANCELLED', 'EXPIRED']) status?: string;
}

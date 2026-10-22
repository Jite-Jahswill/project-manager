import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

export class RegisterDto {
  @ApiProperty() @IsEmail() @MaxLength(254) email!: string;
  @ApiProperty({ minLength: PASSWORD_MIN }) @IsString() @Length(PASSWORD_MIN, PASSWORD_MAX) password!: string;
  @ApiProperty() @IsString() @Length(1, 120) displayName!: string;
}

export enum ClientTypeDto {
  WEB = 'WEB',
  MOBILE = 'MOBILE',
}

export class LoginDto {
  @ApiProperty() @IsEmail() @MaxLength(254) email!: string;
  @ApiProperty() @IsString() @Length(1, PASSWORD_MAX) password!: string;
  @ApiProperty({ enum: ClientTypeDto }) @IsEnum(ClientTypeDto) clientType!: ClientTypeDto;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) deviceName?: string;
  @ApiPropertyOptional({ description: 'Mobile: the deviceToken returned by a previous login on this device (web uses a cookie).' })
  @IsOptional() @IsString() @MaxLength(512) deviceToken?: string;
}

export class RefreshDto {
  @ApiPropertyOptional({ description: 'Mobile clients send the refresh token here; web uses the cookie.' })
  @IsOptional() @IsString() @MaxLength(200) refreshToken?: string;
}

export class TokenDto {
  @ApiProperty() @IsString() @Length(10, 200) token!: string;
}

export class EmailDto {
  @ApiProperty() @IsEmail() @MaxLength(254) email!: string;
}

export class ResetPasswordDto {
  @ApiProperty() @IsString() @Length(10, 200) token!: string;
  @ApiProperty({ minLength: PASSWORD_MIN }) @IsString() @Length(PASSWORD_MIN, PASSWORD_MAX) newPassword!: string;
}

export class ReauthenticateDto {
  @ApiProperty() @IsString() @Length(1, PASSWORD_MAX) password!: string;
}

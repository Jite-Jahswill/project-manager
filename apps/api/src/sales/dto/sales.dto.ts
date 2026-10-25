import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsEmail, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min,
  ValidateIf, ValidateNested,
} from 'class-validator';
import { QUANTITY_PATTERN } from '../../inventory/quantity';

const MONEY = /^\d{1,16}$/;
export const PAYMENT_METHODS = ['CASH', 'CARD_EXTERNAL', 'BANK_TRANSFER', 'MOBILE_MONEY', 'OTHER'] as const;
export type PaymentMethodKey = (typeof PAYMENT_METHODS)[number];

// ---------------------------------------------------------------- customers

export class CreateCustomerDto {
  @ApiProperty() @IsString() @Length(1, 200) @Matches(/\S/) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() @MaxLength(254) email?: string;
  @ApiPropertyOptional({ example: '+234 803 000 0000' }) @IsOptional() @Matches(/^[+0-9 ().-]{6,32}$/) phone?: string;
  @ApiPropertyOptional({ maxLength: 1000 }) @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  @ApiPropertyOptional({ description: 'Branch that registers the customer (branch-limited staff see their branches\' customers)' })
  @IsOptional() @IsUUID() homeBranchId?: string;
}

export class UpdateCustomerDto {
  @ApiProperty() @IsInt() @Min(1) version!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 200) @Matches(/\S/) name?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((o: UpdateCustomerDto) => o.email !== null) @IsEmail() @MaxLength(254) email?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((o: UpdateCustomerDto) => o.phone !== null) @Matches(/^[+0-9 ().-]{6,32}$/) phone?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((o: UpdateCustomerDto) => o.notes !== null) @IsString() @MaxLength(1000) notes?: string | null;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] }) @IsOptional() @IsIn(['ACTIVE', 'INACTIVE']) status?: 'ACTIVE' | 'INACTIVE';
}

export class ListCustomersQuery {
  @ApiPropertyOptional({ description: 'Name, email or phone; % and _ match literally' }) @IsOptional() @IsString() @MaxLength(100) q?: string;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] }) @IsOptional() @IsIn(['ACTIVE', 'INACTIVE']) status?: 'ACTIVE' | 'INACTIVE';
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(600) cursor?: string;
  @ApiPropertyOptional({ maximum: 200 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}

// ---------------------------------------------------------------- sessions

export class OpenSessionDto {
  @ApiProperty({ description: 'Cash in the drawer at opening, minor units' }) @Matches(MONEY) openingFloatMinor!: string;
}

export class CloseSessionDto {
  @ApiProperty() @IsInt() @Min(1) version!: number;
  @ApiProperty({ description: 'Cash counted in the drawer, minor units' }) @Matches(MONEY) declaredCashMinor!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class ListSessionsQuery {
  @ApiPropertyOptional({ enum: ['OPEN', 'CLOSED'] }) @IsOptional() @IsIn(['OPEN', 'CLOSED']) status?: 'OPEN' | 'CLOSED';
}

// ---------------------------------------------------------------- sales

export class SaleLineDto {
  @ApiProperty() @IsUUID() productId!: string;
  @ApiProperty({ example: '2' }) @Matches(QUANTITY_PATTERN) quantity!: string;
}

export class CreateSaleDto {
  @ApiProperty({ type: [SaleLineDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => SaleLineDto)
  lines!: SaleLineDto[];
  @ApiPropertyOptional() @IsOptional() @IsUUID() customerId?: string;
  @ApiPropertyOptional({ description: 'Exchange: the return this replacement sale follows' }) @IsOptional() @IsUUID() relatedReturnId?: string;
}

export class VoidSaleDto {
  @ApiProperty() @IsInt() @Min(1) version!: number;
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
}

export class ListSalesQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() customerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() sessionId?: string;
  @ApiPropertyOptional({ enum: ['COMPLETED', 'VOIDED'] }) @IsOptional() @IsIn(['COMPLETED', 'VOIDED']) status?: 'COMPLETED' | 'VOIDED';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) cursor?: string;
  @ApiPropertyOptional({ maximum: 200 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}

// ---------------------------------------------------------------- payments and refunds

export class RecordPaymentDto {
  @ApiProperty({ enum: PAYMENT_METHODS }) @IsIn(PAYMENT_METHODS) method!: PaymentMethodKey;
  @ApiProperty() @Matches(MONEY) amountMinor!: string;
  @ApiPropertyOptional({ description: 'Terminal slip or transfer reference. Never card numbers, CVVs or credentials.' })
  @IsOptional() @IsString() @Length(1, 100) reference?: string;
}

export class VersionDto {
  @ApiProperty() @IsInt() @Min(1) version!: number;
}

export class FailPaymentDto {
  @ApiProperty() @IsInt() @Min(1) version!: number;
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
}

export class RefundDto {
  @ApiProperty() @Matches(MONEY) amountMinor!: string;
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
  @ApiPropertyOptional({ description: 'The return this refund settles' }) @IsOptional() @IsUUID() returnId?: string;
}

// ---------------------------------------------------------------- returns

export class ReturnLineDto {
  @ApiProperty() @IsUUID() saleLineId!: string;
  @ApiProperty() @Matches(QUANTITY_PATTERN) quantity!: string;
  @ApiProperty({ enum: ['RESALEABLE', 'DAMAGED', 'UNSELLABLE'], description: 'Only RESALEABLE goods can later be restocked' })
  @IsIn(['RESALEABLE', 'DAMAGED', 'UNSELLABLE']) disposition!: 'RESALEABLE' | 'DAMAGED' | 'UNSELLABLE';
}

export class AcceptReturnDto {
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
  @ApiProperty({ type: [ReturnLineDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => ReturnLineDto)
  lines!: ReturnLineDto[];
}

export class SalesReportQuery {
  @ApiPropertyOptional({ example: '2026-01-01' }) @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional({ example: '2026-12-31' }) @IsOptional() @IsDateString() to?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
}

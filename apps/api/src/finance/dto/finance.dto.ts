import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';

/** Integer minor units of the record's currency, as a string ("1250" = 12.50 in a 2-decimal currency). */
const MONEY = /^\d{1,16}$/;
const CURRENCY = /^[A-Z]{3}$/;
/** A calendar date, YYYY-MM-DD (validated as a real date by the service). */
export const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const EXPENSE_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED', 'VOIDED'] as const;
export type ExpenseStatusKey = (typeof EXPENSE_STATUSES)[number];
/** Types a caller may record; REVERSAL is created only by POST …/cash-movements/:id/reverse. */
export const CASH_TYPES = ['PAID_IN', 'PAID_OUT', 'CASH_DROP', 'BANK_DEPOSIT', 'BANK_WITHDRAWAL'] as const;
export type CashTypeKey = (typeof CASH_TYPES)[number];

// ---------------------------------------------------------------- categories

export class CreateExpenseCategoryDto {
  @ApiProperty() @IsString() @Length(1, 100) @Matches(/\S/) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
}

export class UpdateExpenseCategoryDto {
  @ApiProperty({ description: 'The version you saw (optimistic concurrency)' }) @IsInt() @Min(1) version!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 100) @Matches(/\S/) name?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((o: UpdateExpenseCategoryDto) => o.description !== null) @IsString() @MaxLength(500)
  description?: string | null;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'ARCHIVED'] }) @IsOptional() @IsIn(['ACTIVE', 'ARCHIVED']) status?: 'ACTIVE' | 'ARCHIVED';
}

// ---------------------------------------------------------------- expenses

export class CreateExpenseDto {
  @ApiProperty() @IsUUID() categoryId!: string;
  @ApiProperty({ description: 'Positive integer minor units of `currency`', example: '125000' }) @Matches(MONEY) amountMinor!: string;
  @ApiPropertyOptional({ description: "ISO 4217 code; defaults to the organization's default currency", example: 'NGN' }) @IsOptional() @Matches(CURRENCY)
  currency?: string;
  @ApiProperty() @IsString() @Length(1, 500) @Matches(/\S/) description!: string;
  @ApiPropertyOptional({ description: 'Supplier invoice or receipt number (not card data)' }) @IsOptional() @IsString() @MaxLength(100) reference?: string;
  @ApiProperty({ description: 'Business date the expense was incurred (YYYY-MM-DD, not in the future)', example: '2026-10-25' }) @Matches(DATE)
  occurredOn!: string;
  @ApiPropertyOptional({ description: 'Branch the expense belongs to; omit for an organization-level expense' }) @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional({ description: 'Correction: the VOIDED expense this one replaces' }) @IsOptional() @IsUUID() correctsExpenseId?: string;
}

export class UpdateExpenseDto {
  @ApiProperty({ description: 'The version you saw (optimistic concurrency)' }) @IsInt() @Min(1) version!: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(MONEY) amountMinor?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(CURRENCY) currency?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 500) @Matches(/\S/) description?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((o: UpdateExpenseDto) => o.reference !== null) @IsString() @MaxLength(100)
  reference?: string | null;
  @ApiPropertyOptional() @IsOptional() @Matches(DATE) occurredOn?: string;
  @ApiPropertyOptional({ nullable: true, description: 'null moves the draft to organization level' }) @IsOptional()
  @ValidateIf((o: UpdateExpenseDto) => o.branchId !== null) @IsUUID() branchId?: string | null;
}

export class ExpenseVersionDto {
  @ApiProperty({ description: 'The version you saw (optimistic concurrency)' }) @IsInt() @Min(1) version!: number;
}

export class ExpenseReasonDto extends ExpenseVersionDto {
  @ApiProperty({ minLength: 3, maxLength: 500 }) @IsString() @Length(3, 500) @Matches(/\S{3}/) reason!: string;
}

export class CancelExpenseDto extends ExpenseVersionDto {
  @ApiPropertyOptional({ maxLength: 500 }) @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class ListExpensesQuery {
  @ApiPropertyOptional({ enum: EXPENSE_STATUSES }) @IsOptional() @IsIn(EXPENSE_STATUSES) status?: ExpenseStatusKey;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional({ description: 'occurredOn from (inclusive, YYYY-MM-DD)' }) @IsOptional() @Matches(DATE) from?: string;
  @ApiPropertyOptional({ description: 'occurredOn to (inclusive, YYYY-MM-DD)' }) @IsOptional() @Matches(DATE) to?: string;
  @ApiPropertyOptional({ enum: ['me'], description: 'Only expenses you created' }) @IsOptional() @IsIn(['me']) createdBy?: 'me';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(600) cursor?: string;
  @ApiPropertyOptional({ maximum: 100 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

// ---------------------------------------------------------------- cash movements

export class RecordCashMovementDto {
  @ApiProperty({ enum: CASH_TYPES }) @IsIn(CASH_TYPES) type!: CashTypeKey;
  @ApiProperty({ description: 'Positive integer minor units', example: '50000' }) @Matches(MONEY) amountMinor!: string;
  @ApiProperty({ minLength: 3, maxLength: 500 }) @IsString() @Length(3, 500) @Matches(/\S{3}/) reason!: string;
  @ApiPropertyOptional({ description: 'Deposit slip or voucher number (recorded, not verified)' }) @IsOptional() @IsString() @MaxLength(100) reference?: string;
  @ApiPropertyOptional({ description: "The cashier session whose drawer the cash goes into or out of (must be OPEN at this branch)" })
  @IsOptional() @IsUUID() sessionId?: string;
  @ApiPropertyOptional({ description: "Without a session; defaults to the organization's default currency (a session fixes its own)" })
  @IsOptional() @Matches(CURRENCY) currency?: string;
}

export class ReverseCashMovementDto {
  @ApiProperty({ minLength: 3, maxLength: 500 }) @IsString() @Length(3, 500) @Matches(/\S{3}/) reason!: string;
}

export class ListCashMovementsQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() sessionId?: string;
  @ApiPropertyOptional({ enum: [...CASH_TYPES, 'REVERSAL'] }) @IsOptional() @IsIn([...CASH_TYPES, 'REVERSAL']) type?: CashTypeKey | 'REVERSAL';
  @ApiPropertyOptional({ description: 'Recorded from (inclusive UTC date)' }) @IsOptional() @Matches(DATE) from?: string;
  @ApiPropertyOptional({ description: 'Recorded to (inclusive UTC date)' }) @IsOptional() @Matches(DATE) to?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(600) cursor?: string;
  @ApiPropertyOptional({ maximum: 100 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

// ---------------------------------------------------------------- reports

export class FinancePeriodQuery {
  @ApiProperty({ description: 'First day (inclusive, YYYY-MM-DD, UTC)', example: '2026-10-01' }) @Matches(DATE) from!: string;
  @ApiProperty({ description: 'Last day (inclusive, YYYY-MM-DD, UTC); at most 366 days after `from`', example: '2026-10-31' }) @Matches(DATE) to!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
}

export const EXPENSE_GROUPS = ['category', 'status', 'branch', 'month'] as const;
export class ExpenseSummaryQuery extends FinancePeriodQuery {
  @ApiProperty({ enum: EXPENSE_GROUPS }) @IsIn(EXPENSE_GROUPS) groupBy!: (typeof EXPENSE_GROUPS)[number];
}

export const EXPORT_KINDS = ['expenses', 'cash-movements'] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

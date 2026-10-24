import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsEmail, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min,
  ValidateIf, ValidateNested,
} from 'class-validator';
import { QUANTITY_PATTERN as QTY, UNITS } from '../quantity';

/** Quantities are decimal strings (up to 3 places) so no floating-point value is ever involved. */
export const QUANTITY_PATTERN = QTY;
/** Money: integer minor units as a string ("1250" = 12.50 in a 2-decimal currency). */
const MONEY = /^\d{1,16}$/;
const UNIT_KEYS = Object.keys(UNITS);

// ---------------------------------------------------------------- catalogue

export class CreateCategoryDto {
  @ApiProperty() @IsString() @Length(1, 120) @Matches(/\S/) name!: string;
  @ApiPropertyOptional({ description: 'A top-level category' }) @IsOptional() @IsUUID() parentId?: string;
}

export class UpdateCategoryDto {
  @ApiProperty() @IsInt() @Min(1) version!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 120) @Matches(/\S/) name?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((o: UpdateCategoryDto) => o.parentId !== null) @IsUUID() parentId?: string | null;
}

export class VersionDto {
  @ApiProperty({ description: 'The version you saw (optimistic concurrency)' }) @IsInt() @Min(1) version!: number;
}

export class ListCategoriesQuery {
  @ApiPropertyOptional({ enum: ['ACTIVE', 'ARCHIVED'] }) @IsOptional() @IsIn(['ACTIVE', 'ARCHIVED']) status?: 'ACTIVE' | 'ARCHIVED';
}

export class CreateProductDto {
  @ApiProperty() @Matches(/^[A-Za-z0-9._-]{1,64}$/) sku!: string;
  @ApiProperty() @IsString() @Length(1, 200) @Matches(/\S/) name!: string;
  @ApiPropertyOptional({ default: 'each', enum: UNIT_KEYS }) @IsOptional() @IsIn(UNIT_KEYS) unit?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional({ example: '4006381333931' }) @IsOptional() @Matches(/^[A-Za-z0-9._-]{4,64}$/) barcode?: string;
  @ApiPropertyOptional({ description: 'Minor units; needs inventory.cost.read' }) @IsOptional() @Matches(MONEY) costPriceMinor?: string;
  @ApiPropertyOptional({ description: 'Minor units' }) @IsOptional() @Matches(MONEY) sellingPriceMinor?: string;
  @ApiPropertyOptional({ description: 'Low-stock threshold per branch' }) @IsOptional() @Matches(QTY) reorderLevel?: string;
}

export class UpdateProductDto {
  @ApiProperty({ description: 'The version you saw (optimistic concurrency)' }) @IsInt() @Min(1) version!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 200) @Matches(/\S/) name?: string;
  @ApiPropertyOptional({ enum: UNIT_KEYS, description: 'Only while the product has no stock history or order lines' }) @IsOptional() @IsIn(UNIT_KEYS) unit?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((o: UpdateProductDto) => o.description !== null) @IsString() @MaxLength(2000) description?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((o: UpdateProductDto) => o.categoryId !== null) @IsUUID() categoryId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((o: UpdateProductDto) => o.barcode !== null) @Matches(/^[A-Za-z0-9._-]{4,64}$/) barcode?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((o: UpdateProductDto) => o.costPriceMinor !== null) @Matches(MONEY) costPriceMinor?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((o: UpdateProductDto) => o.sellingPriceMinor !== null) @Matches(MONEY) sellingPriceMinor?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((o: UpdateProductDto) => o.reorderLevel !== null) @Matches(QTY) reorderLevel?: string | null;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] }) @IsOptional() @IsIn(['ACTIVE', 'INACTIVE']) status?: 'ACTIVE' | 'INACTIVE';
}

export class ListProductsQuery {
  @ApiPropertyOptional({ description: 'Name, SKU or barcode; % and _ match literally' }) @IsOptional() @IsString() @MaxLength(100) q?: string;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE', 'ARCHIVED'] }) @IsOptional() @IsIn(['ACTIVE', 'INACTIVE', 'ARCHIVED']) status?: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(600) cursor?: string;
  @ApiPropertyOptional({ maximum: 200 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}

// ---------------------------------------------------------------- stock

export class StockAdjustmentDto {
  @ApiProperty() @IsUUID() productId!: string;
  @ApiProperty({ example: '-2.500', description: 'Signed decimal string, non-zero' }) @Matches(QTY) quantityDelta!: string;
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
}

export class OpeningBalanceDto {
  @ApiProperty() @IsUUID() productId!: string;
  @ApiProperty({ example: '120' }) @Matches(QTY) quantity!: string;
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
  @ApiPropertyOptional({ description: 'Minor units; needs inventory.cost.read' }) @IsOptional() @Matches(MONEY) unitCostMinor?: string;
}

export class QuantityLineDto {
  @ApiProperty() @IsUUID() productId!: string;
  @ApiProperty() @Matches(QTY) quantity!: string;
}

export class CountLineDto {
  @ApiProperty() @IsUUID() productId!: string;
  @ApiProperty({ description: 'What was physically counted' }) @Matches(QTY) countedQuantity!: string;
}

export class StockCountDto {
  @ApiProperty() @IsString() @Length(3, 500) note!: string;
  @ApiProperty({ type: [CountLineDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => CountLineDto) lines!: CountLineDto[];
}

export class StockTransferDto {
  @ApiProperty() @IsUUID() toBranchId!: string;
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
  @ApiProperty({ type: [QuantityLineDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => QuantityLineDto) lines!: QuantityLineDto[];
}

export class ReverseMovementDto {
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
}

export class ListBalancesQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) q?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(600) cursor?: string;
  @ApiPropertyOptional({ maximum: 200 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}

export class ListMovementsQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() productId?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(['ADJUSTMENT', 'OPENING', 'RECEIPT', 'TRANSFER_OUT', 'TRANSFER_IN', 'COUNT', 'RETURN_TO_SUPPLIER', 'RECEIPT_CORRECTION', 'REVERSAL'])
  type?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) cursor?: string;
  @ApiPropertyOptional({ maximum: 200 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}

// ---------------------------------------------------------------- suppliers

export class CreateSupplierDto {
  @ApiProperty({ example: 'SUP-001' }) @Matches(/^[A-Za-z0-9._-]{1,32}$/) code!: string;
  @ApiProperty() @IsString() @Length(1, 200) @Matches(/\S/) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) contactName?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() @MaxLength(254) email?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[+0-9 ()-]{5,32}$/) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) address?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[A-Za-z0-9 ./-]{2,40}$/) taxId?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(365) paymentTermsDays?: number;
  @ApiPropertyOptional({ description: 'Defaults to the organization currency' }) @IsOptional() @Matches(/^[A-Z]{3}$/) currency?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class UpdateSupplierDto {
  @ApiProperty() @IsInt() @Min(1) version!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 200) @Matches(/\S/) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) contactName?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() @MaxLength(254) email?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[+0-9 ()-]{5,32}$/) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) address?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[A-Za-z0-9 ./-]{2,40}$/) taxId?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(365) paymentTermsDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] }) @IsOptional() @IsIn(['ACTIVE', 'INACTIVE']) status?: 'ACTIVE' | 'INACTIVE';
}

export class ListSuppliersQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) q?: string;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] }) @IsOptional() @IsIn(['ACTIVE', 'INACTIVE']) status?: 'ACTIVE' | 'INACTIVE';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(600) cursor?: string;
  @ApiPropertyOptional({ maximum: 200 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}

export class SupplierProductDto {
  @ApiPropertyOptional() @IsOptional() @Matches(/^[A-Za-z0-9._-]{1,64}$/) supplierSku?: string;
  @ApiPropertyOptional({ description: 'Minor units; needs inventory.cost.read' }) @IsOptional() @Matches(MONEY) defaultUnitCostMinor?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(365) leadTimeDays?: number;
}

// ---------------------------------------------------------------- purchasing

export class PurchaseOrderLineDto {
  @ApiProperty() @IsUUID() productId!: string;
  @ApiProperty() @Matches(QTY) quantity!: string;
  @ApiProperty({ description: 'Minor units per unit' }) @Matches(MONEY) unitCostMinor!: string;
}

export class CreatePurchaseOrderDto {
  @ApiProperty() @IsUUID() supplierId!: string;
  @ApiProperty({ type: [PurchaseOrderLineDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => PurchaseOrderLineDto)
  lines!: PurchaseOrderLineDto[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @ApiPropertyOptional({ example: '2026-11-15' }) @IsOptional() @IsDateString() expectedDate?: string;
}

export class UpdatePurchaseOrderDto {
  @ApiProperty() @IsInt() @Min(1) version!: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() supplierId?: string;
  @ApiPropertyOptional({ type: [PurchaseOrderLineDto], description: 'Replaces all lines' })
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => PurchaseOrderLineDto) lines?: PurchaseOrderLineDto[];
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((o: UpdatePurchaseOrderDto) => o.notes !== null) @IsString() @MaxLength(2000) notes?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((o: UpdatePurchaseOrderDto) => o.expectedDate !== null) @IsDateString() expectedDate?: string | null;
}

export class ReasonedVersionDto {
  @ApiProperty() @IsInt() @Min(1) version!: number;
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
}

export class ReceiptLineDto {
  @ApiProperty() @IsUUID() lineId!: string;
  @ApiProperty() @Matches(QTY) quantity!: string;
}

export class GoodsReceiptDto {
  @ApiProperty({ type: [ReceiptLineDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => ReceiptLineDto)
  lines!: ReceiptLineDto[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class SupplierReturnDto {
  @ApiProperty({ enum: ['RETURN', 'RECEIPT_CORRECTION'] }) @IsIn(['RETURN', 'RECEIPT_CORRECTION']) type!: 'RETURN' | 'RECEIPT_CORRECTION';
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
  @ApiProperty({ type: [ReceiptLineDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => ReceiptLineDto)
  lines!: ReceiptLineDto[];
}

export class ListPurchaseOrdersQuery {
  @ApiPropertyOptional({ enum: ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED'] })
  @IsOptional() @IsIn(['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED']) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() supplierId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) cursor?: string;
  @ApiPropertyOptional({ maximum: 200 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}

export class PurchasingReportQuery {
  @ApiPropertyOptional({ example: '2026-01-01' }) @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional({ example: '2026-12-31' }) @IsOptional() @IsDateString() to?: string;
}

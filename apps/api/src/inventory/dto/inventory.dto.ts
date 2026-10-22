import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Length, Matches, MaxLength } from 'class-validator';

export class CreateProductDto {
  @ApiProperty() @Matches(/^[A-Za-z0-9._-]{1,64}$/) sku!: string;
  @ApiProperty() @IsString() @Length(1, 200) name!: string;
  @ApiPropertyOptional({ default: 'each' }) @IsOptional() @IsString() @Length(1, 20) unit?: string;
}

export class UpdateProductDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 200) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 20) unit?: string;
}

export class ListProductsQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) q?: string;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'ARCHIVED'] }) @IsOptional() @IsIn(['ACTIVE', 'ARCHIVED']) status?: 'ACTIVE' | 'ARCHIVED';
}

/** Quantities are decimal strings (up to 3 places) so no floating-point value is ever involved. */
export const QUANTITY_PATTERN = /^-?\d{1,15}(\.\d{1,3})?$/;

export class StockAdjustmentDto {
  @ApiProperty() @IsUUID() productId!: string;
  @ApiProperty({ example: '-2.500', description: 'Signed decimal string, non-zero' }) @Matches(QUANTITY_PATTERN) quantityDelta!: string;
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
}

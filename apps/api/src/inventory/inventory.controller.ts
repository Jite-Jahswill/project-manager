import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { Meta, OrgAccess, RequestMeta } from '../common/request-context';
import type { EffectiveAccess } from '../authz/permission-evaluator';
import { RequirePermission } from '../authz/org-access.guard';
import { CreateProductDto, ListProductsQuery, StockAdjustmentDto, UpdateProductDto } from './dto/inventory.dto';
import { ProductsService } from './products.service';
import { StockService } from './stock.service';

@ApiTags('inventory')
@Controller('v1/orgs/:orgId')
export class InventoryController {
  constructor(
    private readonly products: ProductsService,
    private readonly stock: StockService,
  ) {}

  @Get('products') @RequirePermission('inventory.product.read')
  list(@OrgAccess() a: EffectiveAccess, @Query() q: ListProductsQuery) {
    return this.products.list(a, q);
  }

  @Get('products/:productId') @RequirePermission('inventory.product.read')
  get(@OrgAccess() a: EffectiveAccess, @Param('productId', ParseUUIDPipe) productId: string) {
    return this.products.get(a, productId);
  }

  @Post('products') @RequirePermission('inventory.product.create')
  create(@OrgAccess() a: EffectiveAccess, @Body() dto: CreateProductDto, @Meta() meta: RequestMeta) {
    return this.products.create(a, dto, meta);
  }

  @Patch('products/:productId') @RequirePermission('inventory.product.update')
  update(
    @OrgAccess() a: EffectiveAccess, @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: UpdateProductDto, @Meta() meta: RequestMeta,
  ) {
    return this.products.update(a, productId, dto, meta);
  }

  @Post('products/:productId/archive') @RequirePermission('inventory.product.archive')
  archive(@OrgAccess() a: EffectiveAccess, @Param('productId', ParseUUIDPipe) productId: string, @Meta() meta: RequestMeta) {
    return this.products.archive(a, productId, meta);
  }

  @Get('branches/:branchId/stock') @RequirePermission('inventory.stock.read', { branchParam: 'branchId' })
  balances(@OrgAccess() a: EffectiveAccess, @Param('branchId', ParseUUIDPipe) branchId: string) {
    return this.stock.listBalances(a, branchId);
  }

  @Get('branches/:branchId/stock/movements') @RequirePermission('inventory.stock.read', { branchParam: 'branchId' })
  movements(@OrgAccess() a: EffectiveAccess, @Param('branchId', ParseUUIDPipe) branchId: string) {
    return this.stock.listMovements(a, branchId);
  }

  @Post('branches/:branchId/stock/adjustments') @RequirePermission('inventory.stock.adjust', { branchParam: 'branchId' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  adjust(
    @OrgAccess() a: EffectiveAccess, @Param('branchId', ParseUUIDPipe) branchId: string,
    @Body() dto: StockAdjustmentDto, @Headers('idempotency-key') idempotencyKey: string | undefined, @Meta() meta: RequestMeta,
  ) {
    return this.stock.adjust(a, branchId, dto, idempotencyKey, meta);
  }
}

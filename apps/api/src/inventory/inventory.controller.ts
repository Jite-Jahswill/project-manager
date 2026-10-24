import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { Meta, OrgAccess, RequestMeta } from '../common/request-context';
import type { EffectiveAccess } from '../authz/permission-evaluator';
import { RequirePermission } from '../authz/org-access.guard';
import {
  CreateCategoryDto, CreateProductDto, ListBalancesQuery, ListCategoriesQuery, ListMovementsQuery, ListProductsQuery, OpeningBalanceDto,
  ReverseMovementDto, StockAdjustmentDto, StockCountDto, StockTransferDto, UpdateCategoryDto, UpdateProductDto, VersionDto,
} from './dto/inventory.dto';
import { ProductsService } from './products.service';
import { StockService } from './stock.service';

const B = { branchParam: 'branchId' };

@ApiTags('inventory')
@Controller('v1/orgs/:orgId')
export class InventoryController {
  constructor(
    private readonly products: ProductsService,
    private readonly stock: StockService,
  ) {}

  // ---------------------------------------------------------------- categories

  @Get('product-categories') @RequirePermission('inventory.product.read')
  categories(@OrgAccess() a: EffectiveAccess, @Query() q: ListCategoriesQuery) {
    return this.products.listCategories(a, q.status);
  }

  @Post('product-categories') @RequirePermission('inventory.category.manage')
  createCategory(@OrgAccess() a: EffectiveAccess, @Body() dto: CreateCategoryDto, @Meta() meta: RequestMeta) {
    return this.products.createCategory(a, dto, meta);
  }

  @Patch('product-categories/:categoryId') @RequirePermission('inventory.category.manage')
  updateCategory(@OrgAccess() a: EffectiveAccess, @Param('categoryId', ParseUUIDPipe) categoryId: string, @Body() dto: UpdateCategoryDto, @Meta() meta: RequestMeta) {
    return this.products.updateCategory(a, categoryId, dto, meta);
  }

  @Post('product-categories/:categoryId/archive') @HttpCode(200) @RequirePermission('inventory.category.manage')
  archiveCategory(@OrgAccess() a: EffectiveAccess, @Param('categoryId', ParseUUIDPipe) categoryId: string, @Body() dto: VersionDto, @Meta() meta: RequestMeta) {
    return this.products.archiveCategory(a, categoryId, dto.version, meta);
  }

  // ---------------------------------------------------------------- products

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
  update(@OrgAccess() a: EffectiveAccess, @Param('productId', ParseUUIDPipe) productId: string, @Body() dto: UpdateProductDto, @Meta() meta: RequestMeta) {
    return this.products.update(a, productId, dto, meta);
  }

  @Post('products/:productId/archive') @RequirePermission('inventory.product.archive')
  archive(@OrgAccess() a: EffectiveAccess, @Param('productId', ParseUUIDPipe) productId: string, @Meta() meta: RequestMeta) {
    return this.products.archive(a, productId, meta);
  }

  // ---------------------------------------------------------------- stock (branch-scoped)

  @Get('branches/:branchId/stock') @RequirePermission('inventory.stock.read', B)
  balances(@OrgAccess() a: EffectiveAccess, @Param('branchId', ParseUUIDPipe) branchId: string, @Query() q: ListBalancesQuery) {
    return this.stock.listBalances(a, branchId, q);
  }

  @Get('branches/:branchId/stock/movements') @RequirePermission('inventory.stock.read', B)
  movements(@OrgAccess() a: EffectiveAccess, @Param('branchId', ParseUUIDPipe) branchId: string, @Query() q: ListMovementsQuery) {
    return this.stock.listMovements(a, branchId, q);
  }

  @Get('branches/:branchId/stock/low') @RequirePermission('inventory.stock.read', B)
  low(@OrgAccess() a: EffectiveAccess, @Param('branchId', ParseUUIDPipe) branchId: string) {
    return this.stock.lowStock(a, branchId);
  }

  @Get('branches/:branchId/stock/reconciliation') @RequirePermission('inventory.stock.read', B)
  reconciliation(@OrgAccess() a: EffectiveAccess, @Param('branchId', ParseUUIDPipe) branchId: string) {
    return this.stock.reconciliation(a, branchId);
  }

  @Post('branches/:branchId/stock/adjustments') @RequirePermission('inventory.stock.adjust', B)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  adjust(
    @OrgAccess() a: EffectiveAccess, @Param('branchId', ParseUUIDPipe) branchId: string,
    @Body() dto: StockAdjustmentDto, @Headers('idempotency-key') idempotencyKey: string | undefined, @Meta() meta: RequestMeta,
  ) {
    return this.stock.adjust(a, branchId, dto, idempotencyKey, meta);
  }

  /** Once per product and branch, before any other movement (repeat = replay). */
  @Post('branches/:branchId/stock/opening-balances') @RequirePermission('inventory.stock.adjust', B)
  opening(@OrgAccess() a: EffectiveAccess, @Param('branchId', ParseUUIDPipe) branchId: string, @Body() dto: OpeningBalanceDto, @Meta() meta: RequestMeta) {
    return this.stock.opening(a, branchId, dto, meta);
  }

  @Post('branches/:branchId/stock/counts') @RequirePermission('inventory.stock.count', B)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  count(
    @OrgAccess() a: EffectiveAccess, @Param('branchId', ParseUUIDPipe) branchId: string,
    @Body() dto: StockCountDto, @Headers('idempotency-key') idempotencyKey: string | undefined, @Meta() meta: RequestMeta,
  ) {
    return this.stock.count(a, branchId, dto, idempotencyKey, meta);
  }

  @Get('branches/:branchId/stock/counts/:countId') @RequirePermission('inventory.stock.read', B)
  getCount(@OrgAccess() a: EffectiveAccess, @Param('branchId', ParseUUIDPipe) branchId: string, @Param('countId', ParseUUIDPipe) countId: string) {
    return this.stock.getCount(a, branchId, countId);
  }

  /** Needs inventory.stock.transfer at the source (guard) and at the destination (service). */
  @Post('branches/:branchId/stock/transfers') @RequirePermission('inventory.stock.transfer', B)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  transfer(
    @OrgAccess() a: EffectiveAccess, @Param('branchId', ParseUUIDPipe) branchId: string,
    @Body() dto: StockTransferDto, @Headers('idempotency-key') idempotencyKey: string | undefined, @Meta() meta: RequestMeta,
  ) {
    return this.stock.transfer(a, branchId, dto, idempotencyKey, meta);
  }

  @Post('branches/:branchId/stock/movements/:movementId/reverse') @RequirePermission('inventory.stock.approve_adjustment', B)
  reverse(
    @OrgAccess() a: EffectiveAccess, @Param('branchId', ParseUUIDPipe) branchId: string, @Param('movementId', ParseUUIDPipe) movementId: string,
    @Body() dto: ReverseMovementDto, @Meta() meta: RequestMeta,
  ) {
    return this.stock.reverse(a, branchId, movementId, dto, meta);
  }
}

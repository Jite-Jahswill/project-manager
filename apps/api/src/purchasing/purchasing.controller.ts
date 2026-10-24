import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { Meta, OrgAccess, RequestMeta } from '../common/request-context';
import type { EffectiveAccess } from '../authz/permission-evaluator';
import { RequireMembership, RequirePermission } from '../authz/org-access.guard';
import {
  CreatePurchaseOrderDto, CreateSupplierDto, GoodsReceiptDto, ListPurchaseOrdersQuery, ListSuppliersQuery, PurchasingReportQuery, ReasonedVersionDto,
  SupplierProductDto, SupplierReturnDto, UpdatePurchaseOrderDto, UpdateSupplierDto, VersionDto,
} from '../inventory/dto/inventory.dto';
import { PurchasingService } from './purchasing.service';
import { SuppliersService } from './suppliers.service';

/**
 * Suppliers and purchase orders. Purchase-order permissions are BRANCH-scoped: routes that
 * address an existing order pass the guard on membership, and the service authorizes against
 * the order's own branch (404 when the caller cannot see orders there).
 */
@ApiTags('purchasing')
@Controller('v1/orgs/:orgId')
export class PurchasingController {
  constructor(
    private readonly suppliers: SuppliersService,
    private readonly orders: PurchasingService,
  ) {}

  // ---------------------------------------------------------------- suppliers

  @Get('suppliers') @RequirePermission('purchasing.supplier.read')
  listSuppliers(@OrgAccess() a: EffectiveAccess, @Query() q: ListSuppliersQuery) {
    return this.suppliers.list(a, q);
  }

  @Get('suppliers/:supplierId') @RequirePermission('purchasing.supplier.read')
  getSupplier(@OrgAccess() a: EffectiveAccess, @Param('supplierId', ParseUUIDPipe) supplierId: string) {
    return this.suppliers.get(a, supplierId);
  }

  @Post('suppliers') @RequirePermission('purchasing.supplier.manage')
  createSupplier(@OrgAccess() a: EffectiveAccess, @Body() dto: CreateSupplierDto, @Meta() meta: RequestMeta) {
    return this.suppliers.create(a, dto, meta);
  }

  @Patch('suppliers/:supplierId') @RequirePermission('purchasing.supplier.manage')
  updateSupplier(@OrgAccess() a: EffectiveAccess, @Param('supplierId', ParseUUIDPipe) supplierId: string, @Body() dto: UpdateSupplierDto, @Meta() meta: RequestMeta) {
    return this.suppliers.update(a, supplierId, dto, meta);
  }

  @Get('suppliers/:supplierId/products') @RequirePermission('purchasing.supplier.read')
  supplierProducts(@OrgAccess() a: EffectiveAccess, @Param('supplierId', ParseUUIDPipe) supplierId: string) {
    return this.suppliers.listProducts(a, supplierId);
  }

  @Put('suppliers/:supplierId/products/:productId') @RequirePermission('purchasing.supplier.manage')
  setSupplierProduct(
    @OrgAccess() a: EffectiveAccess, @Param('supplierId', ParseUUIDPipe) supplierId: string, @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: SupplierProductDto, @Meta() meta: RequestMeta,
  ) {
    return this.suppliers.setProduct(a, supplierId, productId, dto, meta);
  }

  @Delete('suppliers/:supplierId/products/:productId') @HttpCode(204) @RequirePermission('purchasing.supplier.manage')
  removeSupplierProduct(
    @OrgAccess() a: EffectiveAccess, @Param('supplierId', ParseUUIDPipe) supplierId: string, @Param('productId', ParseUUIDPipe) productId: string,
    @Meta() meta: RequestMeta,
  ) {
    return this.suppliers.removeProduct(a, supplierId, productId, meta);
  }

  @Get('suppliers/:supplierId/summary') @RequirePermission('purchasing.report.read')
  supplierSummary(@OrgAccess() a: EffectiveAccess, @Param('supplierId', ParseUUIDPipe) supplierId: string) {
    return this.suppliers.summary(a, supplierId);
  }

  // ---------------------------------------------------------------- purchase orders

  /** Lists orders at the branches where the caller holds purchasing.order.read. */
  @Get('purchase-orders') @RequireMembership()
  listOrders(@OrgAccess() a: EffectiveAccess, @Query() q: ListPurchaseOrdersQuery) {
    return this.orders.list(a, q);
  }

  @Post('branches/:branchId/purchase-orders') @RequirePermission('purchasing.order.create', { branchParam: 'branchId' })
  createOrder(@OrgAccess() a: EffectiveAccess, @Param('branchId', ParseUUIDPipe) branchId: string, @Body() dto: CreatePurchaseOrderDto, @Meta() meta: RequestMeta) {
    return this.orders.create(a, branchId, dto, meta);
  }

  @Get('purchase-orders/:purchaseOrderId') @RequireMembership()
  getOrder(@OrgAccess() a: EffectiveAccess, @Param('purchaseOrderId', ParseUUIDPipe) id: string) {
    return this.orders.get(a, id);
  }

  @Patch('purchase-orders/:purchaseOrderId') @RequireMembership()
  updateOrder(@OrgAccess() a: EffectiveAccess, @Param('purchaseOrderId', ParseUUIDPipe) id: string, @Body() dto: UpdatePurchaseOrderDto, @Meta() meta: RequestMeta) {
    return this.orders.update(a, id, dto, meta);
  }

  @Post('purchase-orders/:purchaseOrderId/submit') @HttpCode(200) @RequireMembership()
  submit(@OrgAccess() a: EffectiveAccess, @Param('purchaseOrderId', ParseUUIDPipe) id: string, @Body() dto: VersionDto, @Meta() meta: RequestMeta) {
    return this.orders.submit(a, id, dto.version, meta);
  }

  @Post('purchase-orders/:purchaseOrderId/approve') @HttpCode(200) @RequireMembership()
  approve(@OrgAccess() a: EffectiveAccess, @Param('purchaseOrderId', ParseUUIDPipe) id: string, @Body() dto: VersionDto, @Meta() meta: RequestMeta) {
    return this.orders.approve(a, id, dto.version, meta);
  }

  @Post('purchase-orders/:purchaseOrderId/reject') @HttpCode(200) @RequireMembership()
  reject(@OrgAccess() a: EffectiveAccess, @Param('purchaseOrderId', ParseUUIDPipe) id: string, @Body() dto: ReasonedVersionDto, @Meta() meta: RequestMeta) {
    return this.orders.reject(a, id, dto, meta);
  }

  @Post('purchase-orders/:purchaseOrderId/issue') @HttpCode(200) @RequireMembership()
  issue(@OrgAccess() a: EffectiveAccess, @Param('purchaseOrderId', ParseUUIDPipe) id: string, @Body() dto: VersionDto, @Meta() meta: RequestMeta) {
    return this.orders.issue(a, id, dto.version, meta);
  }

  @Post('purchase-orders/:purchaseOrderId/cancel') @HttpCode(200) @RequireMembership()
  cancel(@OrgAccess() a: EffectiveAccess, @Param('purchaseOrderId', ParseUUIDPipe) id: string, @Body() dto: ReasonedVersionDto, @Meta() meta: RequestMeta) {
    return this.orders.cancel(a, id, dto, meta);
  }

  @Post('purchase-orders/:purchaseOrderId/close') @HttpCode(200) @RequireMembership()
  close(@OrgAccess() a: EffectiveAccess, @Param('purchaseOrderId', ParseUUIDPipe) id: string, @Body() dto: ReasonedVersionDto, @Meta() meta: RequestMeta) {
    return this.orders.close(a, id, dto, meta);
  }

  @Post('purchase-orders/:purchaseOrderId/receipts') @RequireMembership()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  receive(
    @OrgAccess() a: EffectiveAccess, @Param('purchaseOrderId', ParseUUIDPipe) id: string, @Body() dto: GoodsReceiptDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined, @Meta() meta: RequestMeta,
  ) {
    return this.orders.receive(a, id, dto, idempotencyKey, meta);
  }

  @Post('purchase-orders/:purchaseOrderId/returns') @RequireMembership()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  returnGoods(
    @OrgAccess() a: EffectiveAccess, @Param('purchaseOrderId', ParseUUIDPipe) id: string, @Body() dto: SupplierReturnDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined, @Meta() meta: RequestMeta,
  ) {
    return this.orders.returnGoods(a, id, dto, idempotencyKey, meta);
  }

  @Get('purchase-orders/:purchaseOrderId/receipts') @RequireMembership()
  receipts(@OrgAccess() a: EffectiveAccess, @Param('purchaseOrderId', ParseUUIDPipe) id: string) {
    return this.orders.receipts(a, id);
  }

  @Get('purchase-orders/:purchaseOrderId/events') @RequireMembership()
  events(@OrgAccess() a: EffectiveAccess, @Param('purchaseOrderId', ParseUUIDPipe) id: string) {
    return this.orders.events(a, id);
  }

  @Get('purchasing/reports/summary') @RequirePermission('purchasing.report.read')
  report(@OrgAccess() a: EffectiveAccess, @Query() q: PurchasingReportQuery) {
    return this.orders.report(a, q);
  }
}

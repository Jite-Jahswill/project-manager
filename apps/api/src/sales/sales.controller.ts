import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { Meta, OrgAccess, RequestMeta } from '../common/request-context';
import type { EffectiveAccess } from '../authz/permission-evaluator';
import { RequireMembership, RequirePermission } from '../authz/org-access.guard';
import { CustomersService } from './customers.service';
import {
  AcceptReturnDto, CloseSessionDto, CreateCustomerDto, CreateSaleDto, FailPaymentDto, ListCustomersQuery, ListSalesQuery, ListSessionsQuery,
  OpenSessionDto, RecordPaymentDto, RefundDto, SalesReportQuery, UpdateCustomerDto, VersionDto, VoidSaleDto,
} from './dto/sales.dto';
import { SalesService } from './sales.service';

const B = { branchParam: 'branchId' };
const IDEMPOTENCY = { name: 'Idempotency-Key', required: true };

/**
 * Point of sale. Routes addressed by a record id (sale, payment, session, return) are
 * authorized in the service against the record's branch: 404 when the caller cannot see it,
 * 403 when they can see it but may not perform the action.
 */
@ApiTags('sales')
@Controller('v1/orgs/:orgId')
export class SalesController {
  constructor(
    private readonly customers: CustomersService,
    private readonly sales: SalesService,
  ) {}

  // ---------------------------------------------------------------- customers

  @Get('customers') @RequirePermission('sales.customer.read')
  listCustomers(@OrgAccess() a: EffectiveAccess, @Query() q: ListCustomersQuery) {
    return this.customers.list(a, q);
  }

  @Get('customers/:customerId') @RequirePermission('sales.customer.read')
  getCustomer(@OrgAccess() a: EffectiveAccess, @Param('customerId', ParseUUIDPipe) customerId: string) {
    return this.customers.get(a, customerId);
  }

  @Post('customers') @RequirePermission('sales.customer.manage')
  createCustomer(@OrgAccess() a: EffectiveAccess, @Body() dto: CreateCustomerDto, @Meta() meta: RequestMeta) {
    return this.customers.create(a, dto, meta);
  }

  /** Also deactivates/reactivates (status). Customers are never deleted: sales reference them. */
  @Patch('customers/:customerId') @RequirePermission('sales.customer.manage')
  updateCustomer(@OrgAccess() a: EffectiveAccess, @Param('customerId', ParseUUIDPipe) customerId: string, @Body() dto: UpdateCustomerDto, @Meta() meta: RequestMeta) {
    return this.customers.update(a, customerId, dto, meta);
  }

  // ---------------------------------------------------------------- cashier sessions

  @Post('branches/:branchId/cashier-sessions') @RequirePermission('sales.session.manage', B)
  openSession(@OrgAccess() a: EffectiveAccess, @Param('branchId', ParseUUIDPipe) branchId: string, @Body() dto: OpenSessionDto, @Meta() meta: RequestMeta) {
    return this.sales.openSession(a, branchId, dto, meta);
  }

  /** Own sessions with sales.session.manage; everyone's with sales.session.supervise. */
  @Get('branches/:branchId/cashier-sessions') @RequireMembership()
  listSessions(@OrgAccess() a: EffectiveAccess, @Param('branchId', ParseUUIDPipe) branchId: string, @Query() q: ListSessionsQuery) {
    return this.sales.listSessions(a, branchId, q.status);
  }

  @Get('cashier-sessions/:sessionId') @RequireMembership()
  getSession(@OrgAccess() a: EffectiveAccess, @Param('sessionId', ParseUUIDPipe) sessionId: string) {
    return this.sales.getSession(a, sessionId);
  }

  @Post('cashier-sessions/:sessionId/close') @HttpCode(200) @RequireMembership()
  closeSession(@OrgAccess() a: EffectiveAccess, @Param('sessionId', ParseUUIDPipe) sessionId: string, @Body() dto: CloseSessionDto, @Meta() meta: RequestMeta) {
    return this.sales.closeSession(a, sessionId, dto, meta);
  }

  // ---------------------------------------------------------------- sales

  @Post('branches/:branchId/sales') @RequirePermission('sales.sale.create', B) @ApiHeader(IDEMPOTENCY)
  createSale(
    @OrgAccess() a: EffectiveAccess, @Param('branchId', ParseUUIDPipe) branchId: string, @Body() dto: CreateSaleDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined, @Meta() meta: RequestMeta,
  ) {
    return this.sales.createSale(a, branchId, dto, idempotencyKey, meta);
  }

  @Get('sales') @RequireMembership()
  listSales(@OrgAccess() a: EffectiveAccess, @Query() q: ListSalesQuery) {
    return this.sales.listSales(a, q);
  }

  @Get('sales/report') @RequirePermission('sales.report.read')
  report(@OrgAccess() a: EffectiveAccess, @Query() q: SalesReportQuery) {
    return this.sales.report(a, q);
  }

  @Get('sales/:saleId') @RequireMembership()
  getSale(@OrgAccess() a: EffectiveAccess, @Param('saleId', ParseUUIDPipe) saleId: string) {
    return this.sales.getSale(a, saleId);
  }

  @Post('sales/:saleId/void') @HttpCode(200) @RequireMembership()
  voidSale(@OrgAccess() a: EffectiveAccess, @Param('saleId', ParseUUIDPipe) saleId: string, @Body() dto: VoidSaleDto, @Meta() meta: RequestMeta) {
    return this.sales.voidSale(a, saleId, dto.version, dto.reason, meta);
  }

  // ---------------------------------------------------------------- payments and refunds

  @Post('sales/:saleId/payments') @RequireMembership() @ApiHeader(IDEMPOTENCY)
  recordPayment(
    @OrgAccess() a: EffectiveAccess, @Param('saleId', ParseUUIDPipe) saleId: string, @Body() dto: RecordPaymentDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined, @Meta() meta: RequestMeta,
  ) {
    return this.sales.recordPayment(a, saleId, dto, idempotencyKey, meta);
  }

  /** Staff attestation that the money arrived (not bank-verified). */
  @Post('payments/:paymentId/confirm') @HttpCode(200) @RequireMembership()
  confirmPayment(@OrgAccess() a: EffectiveAccess, @Param('paymentId', ParseUUIDPipe) paymentId: string, @Body() dto: VersionDto, @Meta() meta: RequestMeta) {
    return this.sales.confirmPayment(a, paymentId, dto.version, meta);
  }

  @Post('payments/:paymentId/fail') @HttpCode(200) @RequireMembership()
  failPayment(@OrgAccess() a: EffectiveAccess, @Param('paymentId', ParseUUIDPipe) paymentId: string, @Body() dto: FailPaymentDto, @Meta() meta: RequestMeta) {
    return this.sales.failPayment(a, paymentId, dto, meta);
  }

  @Post('payments/:paymentId/refunds') @RequireMembership() @ApiHeader(IDEMPOTENCY)
  refund(
    @OrgAccess() a: EffectiveAccess, @Param('paymentId', ParseUUIDPipe) paymentId: string, @Body() dto: RefundDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined, @Meta() meta: RequestMeta,
  ) {
    return this.sales.refund(a, paymentId, dto, idempotencyKey, meta);
  }

  // ---------------------------------------------------------------- returns

  @Post('sales/:saleId/returns') @RequireMembership() @ApiHeader(IDEMPOTENCY)
  acceptReturn(
    @OrgAccess() a: EffectiveAccess, @Param('saleId', ParseUUIDPipe) saleId: string, @Body() dto: AcceptReturnDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined, @Meta() meta: RequestMeta,
  ) {
    return this.sales.acceptReturn(a, saleId, dto, idempotencyKey, meta);
  }

  @Post('returns/:returnId/restock') @HttpCode(200) @RequireMembership()
  restock(@OrgAccess() a: EffectiveAccess, @Param('returnId', ParseUUIDPipe) returnId: string, @Meta() meta: RequestMeta) {
    return this.sales.restock(a, returnId, meta);
  }
}

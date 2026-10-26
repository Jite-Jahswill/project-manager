import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { ApiConsumes, ApiHeader, ApiTags } from '@nestjs/swagger';
import { RateLimit } from '../abuse/rate-limit.guard';
import { RequireMembership, RequirePermission } from '../authz/org-access.guard';
import type { EffectiveAccess } from '../authz/permission-evaluator';
import { Meta, OrgAccess, RequestMeta, VentidocRequest } from '../common/request-context';
import { attachmentHeaders } from '../support/support.controller';
import { readUpload } from '../support/support-attachments.service';
import { CashMovementsService } from './cash-movements.service';
import {
  CancelExpenseDto, CreateExpenseCategoryDto, CreateExpenseDto, ExpenseReasonDto, ExpenseSummaryQuery, ExpenseVersionDto, ExportKind,
  FinancePeriodQuery, ListCashMovementsQuery, ListExpensesQuery, RecordCashMovementDto, ReverseCashMovementDto, UpdateExpenseCategoryDto, UpdateExpenseDto,
} from './dto/finance.dto';
import { ExpensesService } from './expenses.service';
import { FinanceReportsService } from './finance-reports.service';

const B = { branchParam: 'branchId' };
const IDEMPOTENCY = { name: 'Idempotency-Key', required: true };

/**
 * Finance (docs/architecture/13-finance.md). Routes carry the coarse guard; services re-check
 * permissions at the record's branch, ownership and separation of duties before anything is
 * revealed or changed.
 */
@ApiTags('finance')
@Controller('v1/orgs/:orgId')
export class FinanceController {
  constructor(
    private readonly expenses: ExpensesService,
    private readonly cash: CashMovementsService,
    private readonly reports: FinanceReportsService,
  ) {}

  // ---------------------------------------------------------------- categories

  @Get('expense-categories') @RequireMembership()
  listCategories(@OrgAccess() a: EffectiveAccess) {
    return this.expenses.listCategories(a);
  }

  @Post('expense-categories') @RequirePermission('finance.category.manage')
  createCategory(@OrgAccess() a: EffectiveAccess, @Body() dto: CreateExpenseCategoryDto, @Meta() meta: RequestMeta) {
    return this.expenses.createCategory(a, dto, meta);
  }

  @Patch('expense-categories/:expenseCategoryId') @RequirePermission('finance.category.manage')
  updateCategory(@OrgAccess() a: EffectiveAccess, @Param('expenseCategoryId', ParseUUIDPipe) id: string, @Body() dto: UpdateExpenseCategoryDto, @Meta() meta: RequestMeta) {
    return this.expenses.updateCategory(a, id, dto, meta);
  }

  // ---------------------------------------------------------------- expenses

  @Post('expenses') @RequireMembership() @ApiHeader(IDEMPOTENCY)
  createExpense(@OrgAccess() a: EffectiveAccess, @Body() dto: CreateExpenseDto, @Headers('idempotency-key') key: string | undefined, @Meta() meta: RequestMeta) {
    return this.expenses.create(a, dto, key, meta);
  }

  @Get('expenses') @RequireMembership()
  listExpenses(@OrgAccess() a: EffectiveAccess, @Query() q: ListExpensesQuery) {
    return this.expenses.list(a, q);
  }

  @Get('expenses/:expenseId') @RequireMembership()
  getExpense(@OrgAccess() a: EffectiveAccess, @Param('expenseId', ParseUUIDPipe) id: string) {
    return this.expenses.get(a, id);
  }

  @Patch('expenses/:expenseId') @RequireMembership()
  updateExpense(@OrgAccess() a: EffectiveAccess, @Param('expenseId', ParseUUIDPipe) id: string, @Body() dto: UpdateExpenseDto, @Meta() meta: RequestMeta) {
    return this.expenses.update(a, id, dto, meta);
  }

  @Post('expenses/:expenseId/submit') @HttpCode(200) @RequireMembership()
  submit(@OrgAccess() a: EffectiveAccess, @Param('expenseId', ParseUUIDPipe) id: string, @Body() dto: ExpenseVersionDto, @Meta() meta: RequestMeta) {
    return this.expenses.submit(a, id, dto, meta);
  }

  @Post('expenses/:expenseId/approve') @HttpCode(200) @RequireMembership()
  approve(@OrgAccess() a: EffectiveAccess, @Param('expenseId', ParseUUIDPipe) id: string, @Body() dto: ExpenseVersionDto, @Meta() meta: RequestMeta) {
    return this.expenses.approve(a, id, dto, meta);
  }

  @Post('expenses/:expenseId/reject') @HttpCode(200) @RequireMembership()
  reject(@OrgAccess() a: EffectiveAccess, @Param('expenseId', ParseUUIDPipe) id: string, @Body() dto: ExpenseReasonDto, @Meta() meta: RequestMeta) {
    return this.expenses.reject(a, id, dto, meta);
  }

  @Post('expenses/:expenseId/cancel') @HttpCode(200) @RequireMembership()
  cancel(@OrgAccess() a: EffectiveAccess, @Param('expenseId', ParseUUIDPipe) id: string, @Body() dto: CancelExpenseDto, @Meta() meta: RequestMeta) {
    return this.expenses.cancel(a, id, dto, meta);
  }

  @Post('expenses/:expenseId/void') @HttpCode(200) @RequireMembership()
  voidExpense(@OrgAccess() a: EffectiveAccess, @Param('expenseId', ParseUUIDPipe) id: string, @Body() dto: ExpenseReasonDto, @Meta() meta: RequestMeta) {
    return this.expenses.void(a, id, dto, meta);
  }

  @Post('expenses/:expenseId/attachments') @RequireMembership() @RateLimit('finance.upload.user', 'user')
  @ApiConsumes('image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain')
  @ApiHeader({ name: 'X-File-Name', required: false, description: 'URL-encoded original file name' })
  async upload(
    @OrgAccess() a: EffectiveAccess, @Param('expenseId', ParseUUIDPipe) id: string, @Req() req: VentidocRequest,
    @Headers('content-type') type: string | undefined, @Headers('x-file-name') name: string | undefined, @Meta() meta: RequestMeta,
  ) {
    return this.expenses.uploadAttachment(a, id, await readUpload(req), type, name, meta);
  }

  @Get('expense-attachments/:expenseAttachmentId/content') @RequireMembership()
  async download(@OrgAccess() a: EffectiveAccess, @Param('expenseAttachmentId', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response, @Meta() meta: RequestMeta) {
    const file = await this.expenses.downloadAttachment(a, id, meta);
    attachmentHeaders(res, file.fileName, file.contentType, file.data.length);
    return new StreamableFile(file.data);
  }

  // ---------------------------------------------------------------- cash movements

  @Post('branches/:branchId/cash-movements') @RequirePermission('finance.cash.record', B) @ApiHeader(IDEMPOTENCY)
  recordCash(
    @OrgAccess() a: EffectiveAccess, @Param('branchId', ParseUUIDPipe) branchId: string, @Body() dto: RecordCashMovementDto,
    @Headers('idempotency-key') key: string | undefined, @Meta() meta: RequestMeta,
  ) {
    return this.cash.record(a, branchId, dto, key, meta);
  }

  @Get('cash-movements') @RequireMembership()
  listCash(@OrgAccess() a: EffectiveAccess, @Query() q: ListCashMovementsQuery) {
    return this.cash.list(a, q);
  }

  @Get('cash-movements/:cashMovementId') @RequireMembership()
  getCash(@OrgAccess() a: EffectiveAccess, @Param('cashMovementId', ParseUUIDPipe) id: string) {
    return this.cash.get(a, id);
  }

  @Post('cash-movements/:cashMovementId/reverse') @RequireMembership() @ApiHeader(IDEMPOTENCY)
  reverseCash(
    @OrgAccess() a: EffectiveAccess, @Param('cashMovementId', ParseUUIDPipe) id: string, @Body() dto: ReverseCashMovementDto,
    @Headers('idempotency-key') key: string | undefined, @Meta() meta: RequestMeta,
  ) {
    return this.cash.reverse(a, id, dto, key, meta);
  }

  // ---------------------------------------------------------------- reports

  @Get('finance/summary') @RequirePermission('finance.report.read')
  summary(@OrgAccess() a: EffectiveAccess, @Query() q: FinancePeriodQuery) {
    return this.reports.summary(a, q);
  }

  @Get('finance/expense-summary') @RequirePermission('finance.report.read')
  expenseSummary(@OrgAccess() a: EffectiveAccess, @Query() q: ExpenseSummaryQuery) {
    return this.reports.expenseSummary(a, q);
  }

  @Get('finance/cash-session-summary') @RequirePermission('finance.report.read')
  cashSessionSummary(@OrgAccess() a: EffectiveAccess, @Query() q: FinancePeriodQuery) {
    return this.reports.cashSessionSummary(a, q);
  }

  @Get('finance/exports/expenses') @RequirePermission('finance.report.export') @RateLimit('finance.export.user', 'user')
  exportExpenses(@OrgAccess() a: EffectiveAccess, @Query() q: FinancePeriodQuery, @Res({ passthrough: true }) res: Response, @Meta() meta: RequestMeta) {
    return this.csv(a, 'expenses', q, res, meta);
  }

  @Get('finance/exports/cash-movements') @RequirePermission('finance.report.export') @RateLimit('finance.export.user', 'user')
  exportCash(@OrgAccess() a: EffectiveAccess, @Query() q: FinancePeriodQuery, @Res({ passthrough: true }) res: Response, @Meta() meta: RequestMeta) {
    return this.csv(a, 'cash-movements', q, res, meta);
  }

  private async csv(a: EffectiveAccess, kind: ExportKind, q: FinancePeriodQuery, res: Response, meta: RequestMeta) {
    const out = await this.reports.export(a, kind, q, meta);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${out.fileName}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Row-Count', String(out.rows));
    return out.csv;
  }
}

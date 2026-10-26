import { Module } from '@nestjs/common';
import { CashMovementsService } from './cash-movements.service';
import { ExpensesService } from './expenses.service';
import { FinanceReportsService } from './finance-reports.service';
import { FinanceController } from './finance.controller';

@Module({
  controllers: [FinanceController],
  providers: [
    ExpensesService,
    CashMovementsService,
    FinanceReportsService,
  ],
})
export class FinanceModule {}

import { Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/env';
import { AttachmentStorage, createAttachmentStorage } from '../support/attachment-storage';
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
    { provide: AttachmentStorage, inject: [APP_CONFIG], useFactory: (config: AppConfig): AttachmentStorage => createAttachmentStorage(config) },
  ],
})
export class FinanceModule {}

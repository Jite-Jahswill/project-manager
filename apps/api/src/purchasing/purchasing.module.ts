import { Module } from '@nestjs/common';
import { PurchasingController } from './purchasing.controller';
import { PurchasingService } from './purchasing.service';
import { SuppliersService } from './suppliers.service';

@Module({
  controllers: [PurchasingController],
  providers: [SuppliersService, PurchasingService],
})
export class PurchasingModule {}

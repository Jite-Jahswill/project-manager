import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { ProductsService } from './products.service';
import { StockService } from './stock.service';

@Module({ controllers: [InventoryController], providers: [ProductsService, StockService] })
export class InventoryModule {}

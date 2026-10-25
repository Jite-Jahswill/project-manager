import { Module } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';

@Module({ controllers: [SalesController], providers: [CustomersService, SalesService] })
export class SalesModule {}

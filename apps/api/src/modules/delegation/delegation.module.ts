import { Module } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { NotificationModule } from '../notification/notification.module.js';
import { DelegationService } from './delegation.service.js';
import { DelegationController } from './delegation.controller.js';

@Module({
  imports: [NotificationModule],
  providers: [PrismaService, DelegationService],
  controllers: [DelegationController],
  exports: [DelegationService],
})
export class DelegationModule {}

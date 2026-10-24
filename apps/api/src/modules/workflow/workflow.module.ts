import { Module } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { WorkflowOrchestratorService } from './workflow-orchestrator.service.js';
import { DocumentWorkflowController } from './document-workflow.controller.js';
import { DocumentReadService } from './document-read.service.js';
import { SlaSchedulerService } from './sla-scheduler.service.js';
import { SlaSchedulerController } from './sla-scheduler.controller.js';
import { NotificationModule } from '../notification/notification.module.js';
import { DelegationModule } from '../delegation/delegation.module.js';
import { DelegationService } from '../delegation/delegation.service.js';

@Module({
  imports: [NotificationModule, DelegationModule],
  controllers: [DocumentWorkflowController, SlaSchedulerController],
  providers: [
    PrismaService,
    DocumentReadService,
    SlaSchedulerService,
    {
      provide: WorkflowOrchestratorService,
      useFactory: (prisma: PrismaService, delegationService: DelegationService) =>
        new WorkflowOrchestratorService(prisma, delegationService),
      inject: [PrismaService, DelegationService],
    },
  ],
  exports: [WorkflowOrchestratorService, DocumentReadService, SlaSchedulerService],
})
export class WorkflowModule {}

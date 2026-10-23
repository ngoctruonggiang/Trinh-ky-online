import { Module } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { WorkflowOrchestratorService } from './workflow-orchestrator.service.js';
import { DocumentWorkflowController } from './document-workflow.controller.js';
import { DocumentReadService } from './document-read.service.js';
import { SlaSchedulerService } from './sla-scheduler.service.js';
import { SlaSchedulerController } from './sla-scheduler.controller.js';
import { NotificationModule } from '../notification/notification.module.js';

@Module({
  imports: [NotificationModule],
  controllers: [DocumentWorkflowController, SlaSchedulerController],
  providers: [
    PrismaService,
    DocumentReadService,
    SlaSchedulerService,
    {
      provide: WorkflowOrchestratorService,
      useFactory: (prisma: PrismaService) => new WorkflowOrchestratorService(prisma),
      inject: [PrismaService],
    },
  ],
  exports: [WorkflowOrchestratorService, DocumentReadService, SlaSchedulerService],
})
export class WorkflowModule {}

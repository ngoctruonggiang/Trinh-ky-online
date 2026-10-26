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
import { SigningModule } from '../signing/signing.module.js';
import { PdfSigningService } from '../signing/engine/pdf-signing.service.js';

@Module({
  imports: [NotificationModule, DelegationModule, SigningModule],
  controllers: [DocumentWorkflowController, SlaSchedulerController],
  providers: [
    PrismaService,
    DocumentReadService,
    SlaSchedulerService,
    {
      provide: WorkflowOrchestratorService,
      useFactory: (
        prisma: PrismaService,
        delegationService: DelegationService,
        pdfSigningService: PdfSigningService
      ) => new WorkflowOrchestratorService(prisma, delegationService, pdfSigningService),
      inject: [PrismaService, DelegationService, PdfSigningService],
    },
  ],
  exports: [WorkflowOrchestratorService, DocumentReadService, SlaSchedulerService],
})
export class WorkflowModule {}

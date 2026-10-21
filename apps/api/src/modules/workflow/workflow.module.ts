import { Module } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { WorkflowOrchestratorService } from './workflow-orchestrator.service.js';
import { DocumentWorkflowController } from './document-workflow.controller.js';
import { DocumentReadService } from './document-read.service.js';

@Module({
  controllers: [DocumentWorkflowController],
  providers: [
    PrismaService,
    DocumentReadService,
    {
      provide: WorkflowOrchestratorService,
      useFactory: (prisma: PrismaService) => new WorkflowOrchestratorService(prisma),
      inject: [PrismaService],
    },
  ],
  exports: [WorkflowOrchestratorService, DocumentReadService],
})
export class WorkflowModule {}

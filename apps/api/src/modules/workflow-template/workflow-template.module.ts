import { Module } from '@nestjs/common';
import { WorkflowTemplateController } from './workflow-template.controller.js';
import { WorkflowTemplateService } from './workflow-template.service.js';
import { PrismaClient } from '@prisma/client';

@Module({
  controllers: [WorkflowTemplateController],
  providers: [
    WorkflowTemplateService,
    {
      provide: PrismaClient,
      useFactory: () => new PrismaClient(),
    },
  ],
  exports: [WorkflowTemplateService],
})
export class WorkflowTemplateModule {}

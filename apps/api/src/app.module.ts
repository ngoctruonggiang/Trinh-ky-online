import { Module } from '@nestjs/common';
import { WorkflowModule } from './modules/workflow/workflow.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { TemplateModule } from './modules/template/template.module.js';
import { WorkflowTemplateModule } from './modules/workflow-template/workflow-template.module.js';
import { NotificationModule } from './modules/notification/notification.module.js';
import { DelegationModule } from './modules/delegation/delegation.module.js';
import { ArtifactModule } from './modules/artifact/artifact.module.js';

@Module({
  imports: [
    WorkflowModule,
    AuthModule,
    TemplateModule,
    WorkflowTemplateModule,
    NotificationModule,
    DelegationModule,
    ArtifactModule,
  ],
})
export class AppModule {}


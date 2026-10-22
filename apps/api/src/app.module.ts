import { Module } from '@nestjs/common';
import { WorkflowModule } from './modules/workflow/workflow.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { TemplateModule } from './modules/template/template.module.js';
import { WorkflowTemplateModule } from './modules/workflow-template/workflow-template.module.js';

@Module({
  imports: [WorkflowModule, AuthModule, TemplateModule, WorkflowTemplateModule],
})
export class AppModule {}


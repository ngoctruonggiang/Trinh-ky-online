import { Module } from '@nestjs/common';
import { WorkflowModule } from './modules/workflow/workflow.module.js';
import { AuthModule } from './modules/auth/auth.module.js';

@Module({
  imports: [WorkflowModule, AuthModule],
})
export class AppModule {}


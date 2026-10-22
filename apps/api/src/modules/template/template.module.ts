import { Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { TemplateController } from './template.controller.js';
import { TemplateService } from './template.service.js';

@Module({
  controllers: [TemplateController],
  providers: [
    TemplateService,
    {
      provide: PrismaClient,
      useFactory: () => new PrismaClient(),
    },
  ],
  exports: [TemplateService],
})
export class TemplateModule {}

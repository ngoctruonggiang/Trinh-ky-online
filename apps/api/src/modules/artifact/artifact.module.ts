import { Module } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { StorageService } from './storage/storage.service.js';
import { PdfGeneratorService } from './pdf-generator.service.js';
import { ArtifactService } from './artifact.service.js';
import { ArtifactController } from './artifact.controller.js';

@Module({
  controllers: [ArtifactController],
  providers: [PrismaService, StorageService, PdfGeneratorService, ArtifactService],
  exports: [ArtifactService, StorageService, PdfGeneratorService],
})
export class ArtifactModule {}

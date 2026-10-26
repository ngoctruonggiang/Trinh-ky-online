import { Module } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { CertificateController } from './certificate.controller.js';
import { DocumentSigningController } from './document-signing.controller.js';
import { CertificateRegistryService } from './certificate-registry.service.js';
import { DevLocalKeystoreProvider } from './providers/dev-local-keystore.provider.js';
import { CloudKmsSigningProvider } from './providers/cloud-kms-signing.provider.js';
import { SIGNING_KEY_PROVIDER } from './providers/signing-key-provider.interface.js';
import { ArtifactModule } from '../artifact/artifact.module.js';
import { PdfSigningService } from './engine/pdf-signing.service.js';
import { TimestampService } from './timestamp/timestamp.service.js';

@Module({
  imports: [ArtifactModule],
  controllers: [CertificateController, DocumentSigningController],
  providers: [
    PrismaService,
    CertificateRegistryService,
    DevLocalKeystoreProvider,
    CloudKmsSigningProvider,
    TimestampService,
    PdfSigningService,
    {
      provide: SIGNING_KEY_PROVIDER,
      useExisting: DevLocalKeystoreProvider,
    },
  ],
  exports: [
    CertificateRegistryService,
    DevLocalKeystoreProvider,
    CloudKmsSigningProvider,
    TimestampService,
    PdfSigningService,
    SIGNING_KEY_PROVIDER,
  ],
})
export class SigningModule {}

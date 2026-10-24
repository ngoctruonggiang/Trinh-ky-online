import { Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { CertificateController } from './certificate.controller.js';
import { CertificateRegistryService } from './certificate-registry.service.js';
import { DevLocalKeystoreProvider } from './providers/dev-local-keystore.provider.js';
import { CloudKmsSigningProvider } from './providers/cloud-kms-signing.provider.js';
import { SIGNING_KEY_PROVIDER } from './providers/signing-key-provider.interface.js';

@Module({
  controllers: [CertificateController],
  providers: [
    PrismaClient,
    CertificateRegistryService,
    DevLocalKeystoreProvider,
    CloudKmsSigningProvider,
    {
      provide: SIGNING_KEY_PROVIDER,
      useExisting: DevLocalKeystoreProvider,
    },
  ],
  exports: [
    CertificateRegistryService,
    DevLocalKeystoreProvider,
    CloudKmsSigningProvider,
    SIGNING_KEY_PROVIDER,
  ],
})
export class SigningModule {}

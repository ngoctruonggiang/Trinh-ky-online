import { Module } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { AuthController } from './auth.controller.js';

@Module({
  controllers: [AuthController],
  providers: [PrismaService],
  exports: [],
})
export class AuthModule {}

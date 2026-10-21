import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { WorkflowExceptionFilter } from './common/filters/workflow-exception.filter.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    })
  );

  app.useGlobalFilters(new WorkflowExceptionFilter());

  const port = process.env.PORT || 4000;
  await app.listen(port);
  console.log(`Backend API Server running at http://localhost:${port}`);
}

bootstrap();

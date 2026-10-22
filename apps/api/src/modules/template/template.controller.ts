import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  Query,
  UseGuards,
  UseFilters,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { UserPrincipal } from '../../common/interfaces/user-principal.interface.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { WorkflowExceptionFilter } from '../../common/filters/workflow-exception.filter.js';
import { TemplateService } from './template.service.js';
import { CreateTemplateDto } from './dto/create-template.dto.js';
import { UpdateTemplateDto } from './dto/update-template.dto.js';
import { PublishTemplateDto } from './dto/publish-template.dto.js';
import { GetTemplatesQueryDto } from './dto/get-templates-query.dto.js';
import { ValidateFormDataDto } from './dto/validate-form-data.dto.js';

@Controller('api/templates')
@UseGuards(AuthGuard)
@UseFilters(WorkflowExceptionFilter)
export class TemplateController {
  constructor(private readonly templateService: TemplateService) {}

  @Get()
  async getTemplates(
    @CurrentUser() user: UserPrincipal,
    @Query() query: GetTemplatesQueryDto
  ) {
    const result = await this.templateService.getTemplates(user, query);
    return {
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    };
  }

  @Get(':id')
  async getTemplateById(
    @Param('id') id: string,
    @CurrentUser() user: UserPrincipal
  ) {
    const result = await this.templateService.getTemplateById(id, user);
    return {
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createTemplate(
    @Body() dto: CreateTemplateDto,
    @CurrentUser() user: UserPrincipal
  ) {
    const result = await this.templateService.createTemplate(dto, user);
    return {
      ...result,
      timestamp: new Date().toISOString(),
    };
  }

  @Put(':id')
  async updateTemplate(
    @Param('id') id: string,
    @Body() dto: UpdateTemplateDto,
    @CurrentUser() user: UserPrincipal
  ) {
    const result = await this.templateService.updateTemplate(id, dto, user);
    return {
      ...result,
      timestamp: new Date().toISOString(),
    };
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  async publishTemplate(
    @Param('id') id: string,
    @Body() dto: PublishTemplateDto,
    @CurrentUser() user: UserPrincipal
  ) {
    const result = await this.templateService.publishTemplate(id, dto, user);
    return {
      ...result,
      timestamp: new Date().toISOString(),
    };
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  async archiveTemplate(
    @Param('id') id: string,
    @CurrentUser() user: UserPrincipal
  ) {
    const result = await this.templateService.archiveTemplate(id, user);
    return {
      ...result,
      timestamp: new Date().toISOString(),
    };
  }

  @Post(':id/validate')
  @HttpCode(HttpStatus.OK)
  async validateFormData(
    @Param('id') id: string,
    @Body() dto: ValidateFormDataDto,
    @CurrentUser() user: UserPrincipal
  ) {
    const result = await this.templateService.validateFormDataForTemplate(
      id,
      dto.formData,
      user
    );
    return {
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    };
  }
}

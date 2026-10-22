import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  UseFilters,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { UserPrincipal } from '../../common/interfaces/user-principal.interface.js';
import { WorkflowExceptionFilter } from '../../common/filters/workflow-exception.filter.js';
import { WorkflowTemplateService } from './workflow-template.service.js';
import { CreateWorkflowTemplateDto } from './dto/create-workflow-template.dto.js';
import { UpdateWorkflowTemplateDto } from './dto/update-workflow-template.dto.js';
import { PublishWorkflowTemplateDto } from './dto/publish-workflow-template.dto.js';
import { GetWorkflowTemplatesQueryDto } from './dto/get-workflow-templates-query.dto.js';

@Controller('api/workflow-templates')
@UseGuards(AuthGuard)
@UseFilters(WorkflowExceptionFilter)
export class WorkflowTemplateController {
  constructor(private readonly workflowTemplateService: WorkflowTemplateService) {}

  @Get()
  async getWorkflowTemplates(
    @CurrentUser() user: UserPrincipal,
    @Query() query: GetWorkflowTemplatesQueryDto
  ) {
    const result = await this.workflowTemplateService.getWorkflowTemplates(user, query);
    return {
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    };
  }

  @Get(':id')
  async getWorkflowTemplateById(
    @Param('id') id: string,
    @CurrentUser() user: UserPrincipal
  ) {
    const result = await this.workflowTemplateService.getWorkflowTemplateById(id, user);
    return {
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createWorkflowTemplate(
    @Body() dto: CreateWorkflowTemplateDto,
    @CurrentUser() user: UserPrincipal
  ) {
    const result = await this.workflowTemplateService.createWorkflowTemplate(dto, user);
    return {
      ...result,
      timestamp: new Date().toISOString(),
    };
  }

  @Put(':id')
  async updateWorkflowTemplate(
    @Param('id') id: string,
    @Body() dto: UpdateWorkflowTemplateDto,
    @CurrentUser() user: UserPrincipal
  ) {
    const result = await this.workflowTemplateService.updateWorkflowTemplate(id, dto, user);
    return {
      ...result,
      timestamp: new Date().toISOString(),
    };
  }

  @Post(':id/draft')
  @HttpCode(HttpStatus.OK)
  async createDraftVersion(
    @Param('id') id: string,
    @CurrentUser() user: UserPrincipal
  ) {
    const result = await this.workflowTemplateService.createDraftVersion(id, user);
    return {
      ...result,
      timestamp: new Date().toISOString(),
    };
  }

  @Get(':id/draft')
  async getDraftVersion(
    @Param('id') id: string,
    @CurrentUser() user: UserPrincipal
  ) {
    const result = await this.workflowTemplateService.getDraftVersion(id, user);
    return {
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    };
  }

  @Put(':id/draft')
  async updateDraftVersion(
    @Param('id') id: string,
    @Body() dto: UpdateWorkflowTemplateDto,
    @CurrentUser() user: UserPrincipal
  ) {
    const result = await this.workflowTemplateService.updateDraftVersion(id, dto, user);
    return {
      ...result,
      timestamp: new Date().toISOString(),
    };
  }

  @Delete(':id/draft')
  @HttpCode(HttpStatus.OK)
  async discardDraftVersion(
    @Param('id') id: string,
    @CurrentUser() user: UserPrincipal
  ) {
    const result = await this.workflowTemplateService.discardDraftVersion(id, user);
    return {
      ...result,
      timestamp: new Date().toISOString(),
    };
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  async publishWorkflowTemplate(
    @Param('id') id: string,
    @Body() dto: PublishWorkflowTemplateDto,
    @CurrentUser() user: UserPrincipal
  ) {
    const result = await this.workflowTemplateService.publishWorkflowTemplate(id, dto, user);
    return {
      ...result,
      timestamp: new Date().toISOString(),
    };
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  async archiveWorkflowTemplate(
    @Param('id') id: string,
    @CurrentUser() user: UserPrincipal
  ) {
    const result = await this.workflowTemplateService.archiveWorkflowTemplate(id, user);
    return {
      ...result,
      timestamp: new Date().toISOString(),
    };
  }
}

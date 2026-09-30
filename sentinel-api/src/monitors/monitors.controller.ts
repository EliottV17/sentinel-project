import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateMonitorDto } from './dto/create-monitor.dto';
import { UpdateMonitorDto } from './dto/update-monitor.dto';
import { MonitorResponseDto } from './dto/monitor-response.dto';
import {
  AlertResponseDto,
  CheckResultResponseDto,
} from './dto/history-alert-response.dto';
import { MonitorsService } from './monitors.service';

@Controller('monitors')
@UseGuards(JwtAuthGuard)
export class MonitorsController {
  constructor(private readonly monitorsService: MonitorsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() createMonitorDto: CreateMonitorDto,
    @CurrentUser() user: any,
  ): Promise<MonitorResponseDto> {
    return this.monitorsService.createMonitor(createMonitorDto, user.id);
  }

  @Get()
  async findAll(@CurrentUser() user: any): Promise<MonitorResponseDto[]> {
    return this.monitorsService.getMonitorsByUser(user.id);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateMonitorDto: UpdateMonitorDto,
    @CurrentUser() user: any,
  ): Promise<MonitorResponseDto> {
    return this.monitorsService.updateMonitor(id, user.id, updateMonitorDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: any,
  ): Promise<{ message: string }> {
    return this.monitorsService.deleteMonitor(id, user.id);
  }

  @Get(':id/history')
  async getHistory(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: any,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ): Promise<CheckResultResponseDto[]> {
    return this.monitorsService.getHistory(id, user.id, limit);
  }

  @Get(':id/alerts')
  async getAlerts(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: any,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ): Promise<AlertResponseDto[]> {
    return this.monitorsService.getAlerts(id, user.id, limit);
  }
}

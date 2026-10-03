import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { PublicStatusResponseDto } from './dto/public-status-response.dto';
import { PublicStatusService } from './public-status.service';

@Controller('public/status')
export class PublicStatusController {
  constructor(private readonly publicStatusService: PublicStatusService) {}

  @Get()
  @Public()
  getStatus(): Promise<PublicStatusResponseDto[]> {
    return this.publicStatusService.getPublicStatus();
  }
}

import { Controller, Get } from '@nestjs/common';
import { Public } from './common/decorators/public.decorator';

@Controller()
export class AppController {
  @Get()
  @Public()
  getRoot() {
    return { message: 'Sentinel API está en línea y vigilando' };
  }
}

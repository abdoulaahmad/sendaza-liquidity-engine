import { Controller, Get } from '@nestjs/common';
import { PublicRoute } from './public-route.decorator';

@PublicRoute()
@Controller('health')
export class HealthController {
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  ready(): { status: 'ready' } {
    return { status: 'ready' };
  }
}

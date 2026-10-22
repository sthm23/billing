import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '@prisma/prisma.service';
import { Public } from '@shared/decorators/public.decorator';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) { }

  @Public()
  @Get()
  async check() {
    try {
      // Check database connection
      await this.prisma.$queryRaw`SELECT 1`;

      return {
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: 'connected',
      };
    } catch (error: any) {
      return {
        status: 'error',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: 'disconnected',
        error: error.message,
      };
    }
  }

  @Public()
  @Get('ready')
  async ready() {
    // Readiness probe - checks if app is ready to accept traffic
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ready' };
    } catch (error: any) {
      return { status: 'not ready', error: error.message };
    }
  }

  @Public()
  @Get('live')
  async live() {
    // Liveness probe - checks if app is running
    return {
      status: 'alive',
      timestamp: new Date().toISOString(),
    };
  }
}

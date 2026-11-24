import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthJWTGuard } from '@auth/guard/auth.guard';
import type { CurrentUser as UserInfo } from '@auth/models/auth.model';
import { StaffRole, UserRole } from '@generated/enums';
import { CurrentUser } from '@shared/decorators/user.decorator';
import { Roles } from '@shared/decorators/role.decorator';
import { RolesGuard } from '@shared/guards/role.guard';
import { DashboardParams } from './dto/dashboard-params.dto';
import { DashboardService, DashboardSummary } from './dashboard.service';

/** Owner dashboard (billing/docs/dashboard/PLAN.md): store owner only. */
@UseGuards(AuthJWTGuard, RolesGuard)
@Roles(UserRole.OWNER, StaffRole.OWNER)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  /** Main block: KPIs, sales chart, payment methods, cash flow, top products, debts. */
  @Get('summary')
  getSummary(
    @Query() params: DashboardParams,
    @CurrentUser() user: UserInfo,
  ): Promise<DashboardSummary> {
    return this.dashboardService.getSummary(params, user);
  }
}

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { CashStatus } from '@generated/enums';
import { Cashbox, Prisma } from '@generated/client';
import { CurrentUser } from '@auth/models/auth.model';
import { staffWarehouseIds } from '@shared/helper/role.helper';

type CashboxClient = Pick<Prisma.TransactionClient, 'cashbox'>;

export const NO_OPEN_CASHBOX =
  'No open cashbox: open one or choose an open cashbox of the store';

/**
 * Cashbox for money of a sale, debt repayment, return or rental. Any employee
 * may use `cashboxId` — an OPEN cashbox of the store on one of their
 * warehouses (the owner: any warehouse); otherwise their own open cashbox,
 * preferably on `warehouseId`. A seller has no own cashbox and always picks one.
 */
export async function resolvePaymentCashbox(
  prisma: CashboxClient,
  user: CurrentUser,
  { cashboxId, warehouseId }: { cashboxId?: string; warehouseId?: string },
): Promise<Cashbox> {
  if (!user.staff) throw new ForbiddenException('Staff only');
  const storeId = user.staff.storeId;

  if (cashboxId) {
    const warehouses = staffWarehouseIds(user);
    const chosen = await prisma.cashbox.findFirst({
      where: {
        id: cashboxId,
        storeId,
        status: CashStatus.OPEN,
        ...(warehouses ? { warehouseId: { in: warehouses } } : {}),
      },
    });
    if (!chosen) {
      throw new BadRequestException(
        'The chosen cashbox is not open or not on your warehouse',
      );
    }
    return chosen;
  }

  const own = await prisma.cashbox.findMany({
    where: { storeId, sellerId: user.staff.id, status: CashStatus.OPEN },
    orderBy: { createdAt: 'desc' },
  });
  const cashbox =
    own.find((c) => c.warehouseId === warehouseId) ?? own[0] ?? null;
  if (!cashbox) throw new BadRequestException(NO_OPEN_CASHBOX);
  return cashbox;
}

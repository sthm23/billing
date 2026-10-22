import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { CashStatus } from '@generated/enums';
import { Cashbox, Prisma } from '@generated/client';
import { CurrentUser } from '@auth/models/auth.model';

type CashboxClient = Pick<Prisma.TransactionClient, 'cashbox'>;

export const NO_OPEN_CASHBOX =
  'No open cashbox: open one or choose an open cashbox of the store';

/**
 * Cashbox that receives a debt repayment. Any employee of the store may take
 * the money: into `cashboxId` (any OPEN cashbox of the store), otherwise into
 * their own open cashbox — preferably on `warehouseId`.
 */
export async function resolvePaymentCashbox(
  prisma: CashboxClient,
  user: CurrentUser,
  { cashboxId, warehouseId }: { cashboxId?: string; warehouseId?: string },
): Promise<Cashbox> {
  if (!user.staff) throw new ForbiddenException('Staff only');
  const storeId = user.staff.storeId;

  if (cashboxId) {
    const chosen = await prisma.cashbox.findFirst({
      where: { id: cashboxId, storeId, status: CashStatus.OPEN },
    });
    if (!chosen) {
      throw new BadRequestException(
        'The chosen cashbox is not open or not in your store',
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

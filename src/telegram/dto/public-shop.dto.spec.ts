import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateOnlineOrderDto, ShopProductsQueryDto } from './public-shop.dto';

const V1 = '11111111-1111-4111-8111-111111111111';

const body = (overrides: Record<string, unknown> = {}) => ({
  items: [{ variantId: V1, quantity: 2 }],
  fullName: 'Ali Valiyev',
  phone: '+998901234567',
  region: 'samarkand',
  district: 'Urgut',
  ...overrides,
});

/** Same as the global ValidationPipe: validates what plainToInstance produces. */
async function problems(
  Type: new () => object,
  plain: Record<string, unknown>,
) {
  const errors = await validate(plainToInstance(Type, plain));

  return errors.map((e) => e.property);
}

describe('CreateOnlineOrderDto', () => {
  it('accepts a normal request', async () => {
    expect(await problems(CreateOnlineOrderDto, body())).toEqual([]);
  });

  it('accepts a phone typed with spaces and dashes, and a missing comment', async () => {
    expect(
      await problems(
        CreateOnlineOrderDto,
        body({ phone: '+998 90 123-45-67' }),
      ),
    ).toEqual([]);
    expect(
      await problems(CreateOnlineOrderDto, body({ phone: '90 123 45 67' })),
    ).toEqual([]);
  });

  it('refuses a foreign or broken phone', async () => {
    expect(
      await problems(CreateOnlineOrderDto, body({ phone: '+79991234567' })),
    ).toEqual(['phone']);
    expect(
      await problems(CreateOnlineOrderDto, body({ phone: 'abc' })),
    ).toEqual(['phone']);
  });

  it('refuses an unknown region and a short name or district', async () => {
    expect(
      await problems(CreateOnlineOrderDto, body({ region: 'mars' })),
    ).toEqual(['region']);
    expect(
      await problems(CreateOnlineOrderDto, body({ fullName: ' a ' })),
    ).toEqual(['fullName']);
    expect(
      await problems(CreateOnlineOrderDto, body({ district: '' })),
    ).toEqual(['district']);
  });

  it('refuses an empty cart, too many lines, bad ids and bad quantities', async () => {
    expect(await problems(CreateOnlineOrderDto, body({ items: [] }))).toEqual([
      'items',
    ]);
    expect(
      await problems(
        CreateOnlineOrderDto,
        body({
          items: Array.from({ length: 51 }, () => ({
            variantId: V1,
            quantity: 1,
          })),
        }),
      ),
    ).toEqual(['items']);
    for (const item of [
      { variantId: 'x', quantity: 1 },
      { variantId: V1, quantity: 0 },
      { variantId: V1, quantity: -1 },
      { variantId: V1, quantity: 1.5 },
      { variantId: V1, quantity: 100000 },
    ]) {
      expect(
        await problems(CreateOnlineOrderDto, body({ items: [item] })),
      ).toEqual(['items']);
    }
  });

  it('refuses a comment over 500 characters', async () => {
    expect(
      await problems(CreateOnlineOrderDto, body({ comment: 'x'.repeat(501) })),
    ).toEqual(['comment']);
  });
});

describe('ShopProductsQueryDto', () => {
  it('accepts numbers sent as query strings', async () => {
    expect(
      await problems(ShopProductsQueryDto, {
        currentPage: '2',
        pageSize: '20',
        search: 'брус',
      }),
    ).toEqual([]);
  });

  it('refuses a page size above the limit, a bad category id and a huge search', async () => {
    expect(await problems(ShopProductsQueryDto, { pageSize: '31' })).toEqual([
      'pageSize',
    ]);
    expect(
      await problems(ShopProductsQueryDto, { categoryId: 'nope' }),
    ).toEqual(['categoryId']);
    expect(
      await problems(ShopProductsQueryDto, { search: 'x'.repeat(101) }),
    ).toEqual(['search']);
  });
});

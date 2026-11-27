import 'reflect-metadata';
import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthJWTGuard } from '@auth/guard/auth.guard';
import { StaffRole, UserRole, UserType } from '@generated/enums';
import { OnlineOrdersController } from './online-orders.controller';
import { OnlineOrderService } from './online-order.service';

/**
 * The staff routes of the Telegram shop requests through a real Nest app: the real RolesGuard
 * and the same ValidationPipe as main.ts. Login is replaced by a header; the service is a stub.
 */
const ID = '33333333-3333-4333-8333-333333333333';
const WAREHOUSE = '11111111-1111-4111-8111-111111111111';

const asStaff = (role: StaffRole, userRole: UserRole = UserRole.USER) =>
  JSON.stringify({
    id: 'user-1',
    role: userRole,
    type: UserType.STAFF,
    auth: { id: 'auth-1' },
    staff: { id: 'staff-1', storeId: 'store-1', role, warehouse: [] },
  });

/** Stands in for the JWT guard: the "signed-in" user comes from the x-user header. */
const fakeLogin: CanActivate = {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string>;
      user?: unknown;
    }>();
    if (!req.headers['x-user']) return false;
    req.user = JSON.parse(req.headers['x-user']);

    return true;
  },
};

describe('Online orders routes over HTTP', () => {
  let app: INestApplication;
  const service = {
    list: jest.fn().mockResolvedValue({ data: [] }),
    findOne: jest.fn().mockResolvedValue({ id: ID }),
    confirm: jest.fn().mockResolvedValue({ orderId: 'order-1' }),
    reject: jest.fn().mockResolvedValue({ customerNotified: true }),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [OnlineOrdersController],
      providers: [{ provide: OnlineOrderService, useValue: service }],
    })
      .overrideGuard(AuthJWTGuard)
      .useValue(fakeLogin)
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe()); // as in main.ts
    await app.init();
  });

  beforeEach(() => jest.clearAllMocks());
  afterAll(() => app.close());

  const as = (role: StaffRole, userRole?: UserRole) => ({
    'x-user': asStaff(role, userRole),
  });

  it('owner, manager and seller may use every route', async () => {
    const people = [
      as(StaffRole.OWNER, UserRole.OWNER),
      as(StaffRole.MANAGER),
      as(StaffRole.SELLER),
    ];
    for (const headers of people) {
      const http = request(app.getHttpServer());
      await http.get('/online-orders').set(headers).expect(200);
      await http.get(`/online-orders/${ID}`).set(headers).expect(200);
      await http
        .post(`/online-orders/${ID}/confirm`)
        .set(headers)
        .send({ warehouseId: WAREHOUSE })
        .expect(200);
      await http
        .post(`/online-orders/${ID}/reject`)
        .set(headers)
        .send({})
        .expect(200);
    }
    expect(service.confirm).toHaveBeenCalledTimes(3);
  });

  it('a cashier and warehouse staff get 403 on every route and reach no service', async () => {
    for (const role of [StaffRole.CASHIER, StaffRole.WAREHOUSE]) {
      const http = request(app.getHttpServer());
      await http.get('/online-orders').set(as(role)).expect(403);
      await http.get(`/online-orders/${ID}`).set(as(role)).expect(403);
      await http
        .post(`/online-orders/${ID}/confirm`)
        .set(as(role))
        .send({ warehouseId: WAREHOUSE })
        .expect(403);
      await http
        .post(`/online-orders/${ID}/reject`)
        .set(as(role))
        .send({})
        .expect(403);
    }
    expect(service.list).not.toHaveBeenCalled();
    expect(service.findOne).not.toHaveBeenCalled();
    expect(service.confirm).not.toHaveBeenCalled();
    expect(service.reject).not.toHaveBeenCalled();
  });

  it('not signed in: refused, nothing reaches the service', async () => {
    await request(app.getHttpServer()).get('/online-orders').expect(403);
    expect(service.list).not.toHaveBeenCalled();
  });

  it('validates the list query with the real pipe and passes it on', async () => {
    const http = request(app.getHttpServer());
    const headers = as(StaffRole.SELLER);

    await http.get('/online-orders?status=DONE').set(headers).expect(400);
    await http.get('/online-orders?pageSize=51').set(headers).expect(400);
    await http.get('/online-orders?currentPage=0').set(headers).expect(400);
    await http
      .get('/online-orders?status=NEW&pageSize=10&currentPage=2')
      .set(headers)
      .expect(200);

    expect(service.list).toHaveBeenCalledTimes(1);
    expect(service.list.mock.calls[0][0]).toMatchObject({ status: 'NEW' });
  });

  it('refuses a request id that is not a UUID', async () => {
    const headers = as(StaffRole.SELLER);

    await request(app.getHttpServer())
      .get('/online-orders/abc')
      .set(headers)
      .expect(400);
    await request(app.getHttpServer())
      .post('/online-orders/abc/confirm')
      .set(headers)
      .send({ warehouseId: WAREHOUSE })
      .expect(400);
    expect(service.findOne).not.toHaveBeenCalled();
  });

  it('confirm needs a warehouse id', async () => {
    const http = request(app.getHttpServer());
    const headers = as(StaffRole.SELLER);

    await http
      .post(`/online-orders/${ID}/confirm`)
      .set(headers)
      .send({})
      .expect(400);
    await http
      .post(`/online-orders/${ID}/confirm`)
      .set(headers)
      .send({ warehouseId: 'nope' })
      .expect(400);
    expect(service.confirm).not.toHaveBeenCalled();
  });

  it('reject takes an optional reason of at most 300 characters', async () => {
    const http = request(app.getHttpServer());
    const headers = as(StaffRole.MANAGER);

    await http
      .post(`/online-orders/${ID}/reject`)
      .set(headers)
      .send({ reason: 'x'.repeat(301) })
      .expect(400);
    await http
      .post(`/online-orders/${ID}/reject`)
      .set(headers)
      .send({ reason: 'Нет в наличии' })
      .expect(200);

    expect(service.reject).toHaveBeenCalledTimes(1);
  });
});

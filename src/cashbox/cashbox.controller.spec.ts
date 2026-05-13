import { Test, TestingModule } from '@nestjs/testing';
import { CashboxController } from './cashbox.controller';
import { CashboxService } from './cashbox.service';

describe('CashboxController', () => {
  let controller: CashboxController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CashboxController],
      providers: [CashboxService],
    }).compile();

    controller = module.get<CashboxController>(CashboxController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});

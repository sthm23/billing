import { Test, TestingModule } from '@nestjs/testing';
import { CashboxService } from './cashbox.service';

describe('CashboxService', () => {
  let service: CashboxService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CashboxService],
    }).compile();

    service = module.get<CashboxService>(CashboxService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

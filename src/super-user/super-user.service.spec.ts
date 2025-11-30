import { Test, TestingModule } from '@nestjs/testing';
import { SuperUserService } from './super-user.service';

describe('SuperUserService', () => {
  let service: SuperUserService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SuperUserService],
    }).compile();

    service = module.get<SuperUserService>(SuperUserService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

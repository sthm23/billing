import { Test, TestingModule } from '@nestjs/testing';
import { CategoryAttributesService } from './category-attributes.service';

describe('CategoryAttributesService', () => {
  let service: CategoryAttributesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CategoryAttributesService],
    }).compile();

    service = module.get<CategoryAttributesService>(CategoryAttributesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

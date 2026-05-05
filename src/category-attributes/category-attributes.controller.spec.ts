import { Test, TestingModule } from '@nestjs/testing';
import { CategoryAttributesController } from './category-attributes.controller';
import { CategoryAttributesService } from './category-attributes.service';

describe('CategoryAttributesController', () => {
  let controller: CategoryAttributesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CategoryAttributesController],
      providers: [CategoryAttributesService],
    }).compile();

    controller = module.get<CategoryAttributesController>(CategoryAttributesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});

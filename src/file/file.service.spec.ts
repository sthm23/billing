import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { S3Service } from '@prisma/s3.service';
import type { CurrentUser } from '@auth/models/auth.model';
import { FileService } from './file.service';

const STORE = '11111111-1111-4111-8111-111111111111';
const FOREIGN_STORE = '22222222-2222-4222-8222-222222222222';

describe('FileService', () => {
  let service: FileService;
  const s3 = {
    createUploadUrl: jest.fn((key: string, _type: string, _size: number) =>
      Promise.resolve({ url: `https://s3/${key}?sig`, key, expiresIn: 600 }),
    ),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [FileService, { provide: S3Service, useValue: s3 }],
    }).compile();

    service = module.get<FileService>(FileService);
  });

  it('builds keys under products/<store from token>/, ignoring storeId from the body', async () => {
    const user = { staff: { storeId: STORE } } as unknown as CurrentUser;
    const res = await service.createProductImage(
      {
        files: [
          {
            storeId: FOREIGN_STORE,
            fileName: 'x.php',
            fileSize: 1234,
            mimeType: 'image/png',
          },
          { fileName: 'photo.HEIC', fileSize: 99, mimeType: 'image/webp' },
        ],
      },
      user,
    );

    expect(s3.createUploadUrl).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(
        new RegExp(String.raw`^products/${STORE}/\d+-\d+\.png$`),
      ),
      'image/png',
      1234,
    );
    expect(s3.createUploadUrl.mock.calls[1][0]).toMatch(/\.webp$/);
    expect(s3.createUploadUrl.mock.calls[1][2]).toBe(99);
    expect(res[0].key).toMatch(new RegExp(`^products/${STORE}/`));
  });

  it('rejects a user without staff (no store)', () => {
    expect(() =>
      service.createProductImage(
        { files: [{ fileName: 'a.jpg', fileSize: 1, mimeType: 'image/jpeg' }] },
        { staff: null } as unknown as CurrentUser,
      ),
    ).toThrow(ForbiddenException);
  });
});

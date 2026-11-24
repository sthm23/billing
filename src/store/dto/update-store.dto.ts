import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateStoreDto {
  @IsOptional()
  @IsString()
  name?: string;

  /** Store sells goods; at least one of salesEnabled / rentalEnabled stays true */
  @IsOptional()
  @IsBoolean()
  salesEnabled?: boolean;

  /** Store rents goods out */
  @IsOptional()
  @IsBoolean()
  rentalEnabled?: boolean;

  /**
   * Keep sellers' voice recordings to improve speech recognition (docs/voice-order/DESIGN.md §7).
   * Turning it off deletes every saved recording of the store.
   */
  @IsOptional()
  @IsBoolean()
  voiceDataConsent?: boolean;

  @IsOptional()
  @IsString()
  warehouseName?: string;

  // Brands / attributes of the store are changed by the platform ADMIN only:
  // /admin/stores/:id/brands | attributes (billing/docs/store-catalog/PLAN.md)
}

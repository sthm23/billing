import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, Matches } from 'class-validator';
import { BOT_SLUG_PATTERN, BOT_TOKEN_PATTERN } from '../telegram.constants';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const trimLower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/**
 * The store comes from the token of the signed-in employee. Only a platform
 * ADMIN (who has no store) names it here; for everyone else it is ignored.
 */
export class StoreScopeDto {
  @IsOptional()
  @IsUUID()
  storeId?: string;
}

/** PUT /telegram-shop/bot */
export class ConnectBotDto extends StoreScopeDto {
  /** Token from @BotFather */
  @Transform(trim)
  @IsString()
  @Matches(BOT_TOKEN_PATTERN, { message: 'Invalid bot token format' })
  token!: string;

  /** Address of the shop in the Mini App URL */
  @Transform(trimLower)
  @IsString()
  @Matches(BOT_SLUG_PATTERN, {
    message: 'Address: 3–32 characters, a–z, 0–9, _ and -',
  })
  slug!: string;
}

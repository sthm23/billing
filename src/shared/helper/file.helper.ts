/** Product photos: allowed types (→ file extension), limits, key prefix. */
export const PRODUCT_IMAGE_MIME_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};
export const PRODUCT_IMAGE_MIME_TYPES = Object.keys(PRODUCT_IMAGE_MIME_EXT);
export const PRODUCT_IMAGE_MAX_SIZE = 5 * 1024 * 1024; // 5 MB, after client compression
export const PRODUCT_IMAGE_MAX_COUNT = 5; // per product
const PRODUCT_IMAGE_ROOT = 'products';

export class FileHelper {
  /** `<timestamp>-<random><ext>`; the extension comes from the validated MIME type, never from the client file name. */
  static createFileName(mimeType: string): string {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    return `${uniqueSuffix}${PRODUCT_IMAGE_MIME_EXT[mimeType] ?? ''}`;
  }

  /** Key prefix of one store's product photos: `products/<storeId>/`. Public read is allowed on `products/*` only. */
  static productImagePrefix(storeId: string): string {
    return `${PRODUCT_IMAGE_ROOT}/${storeId}/`;
  }

  /** Public base URL of the bucket (`S3_PUBLIC_URL`, e.g. `https://s3.uztelecom.uz/sthm-media`), without trailing slash. */
  private static publicBase(): string {
    return (process.env.S3_PUBLIC_URL ?? '').replace(/\/+$/, '');
  }

  /** Object key → public URL. The DB stores keys only. */
  static toPublicUrl(key: string): string {
    return `${FileHelper.publicBase()}/${key}`;
  }

  /**
   * Value from a client → object key. Accepts a bare key or a full URL under `S3_PUBLIC_URL`
   * (the web client sends the presigned URL without its query). Anything else → null.
   */
  static toKey(value: string): string | null {
    const raw = value.trim().split('?')[0];
    if (!raw) return null;
    if (!/^https?:\/\//i.test(raw)) return raw.replace(/^\/+/, '');
    const base = FileHelper.publicBase();
    if (!base || !raw.startsWith(`${base}/`)) return null;
    return decodeURIComponent(raw.slice(base.length + 1));
  }
}

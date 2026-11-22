export interface PresignedUrlResult {
  /** Presigned PUT URL */
  url: string;
  /** Object key; send it back in `images` when creating the product */
  key: string;
  expiresIn: number;
}

export interface S3ObjectInfo {
  size: number;
  contentType: string;
}

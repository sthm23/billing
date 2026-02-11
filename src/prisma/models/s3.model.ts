

export interface PresignedUrlResult {
    url: string;
    expiresIn: number;
}
export interface S3KeyParams {
    storeId: string;
    imgName: string;
    pathName: string;
}

export interface UploadFileParam extends S3KeyParams {
    mimetype: string;
}
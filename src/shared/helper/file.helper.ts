import * as path from "path";
import * as fs from 'fs';
import sharp from 'sharp';

export class FileHelper {
    static createFileName(file: Express.Multer.File, folderName: string = 'temp'): string {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        const ext = path.extname(file.originalname);
        const fileName = `${uniqueSuffix}${ext}`;
        return `${folderName}/${fileName}`;
    }

    static compressImage(file: Express.Multer.File) {
        return sharp(file.buffer)
            .webp({ quality: 75 })
            .toBuffer()
    }

    // static writeFile(fileName: string, buffer: string | NodeJS.ArrayBufferView) {
    //     const outputDir = path.join(process.cwd(), 'uploads');
    //     fs.mkdirSync(outputDir, { recursive: true });
    //     const filePath = path.join(outputDir, fileName);
    //     fs.writeFileSync(filePath, buffer)
    // }
}
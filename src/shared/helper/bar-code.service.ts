import { Injectable } from '@nestjs/common';
import { PrismaService } from '@prisma/prisma.service';

@Injectable()
export class BarcodeService {
    constructor(private prisma: PrismaService) { }

    /**
     * Генерирует уникальный EAN-13 баркод
     * Использует последовательный счетчик для гарантии уникальности
     */
    async generateUniqueBarcode(prisma: any): Promise<string> {
        const sequence = await prisma.barcodeSequence.upsert({
            where: { id: 1 },
            update: { nextCode: { increment: 1 } },
            create: { id: 1, nextCode: 200000000000n },
        });

        const base12 = sequence.nextCode.toString().padStart(12, '0').slice(-12);
        return base12 + this.ean13CheckDigit(base12);
    }


    /**
     * Получить текущий номер для отладки
     */
    async getCurrentNumber(): Promise<BigInt> {
        const sequence = await this.prisma.barcodeSequence.findUnique({
            where: { id: 1 },
        });
        return sequence?.nextCode || 2000000000001n;
    }

    private ean13CheckDigit(twelveDigits: string): string {
        let sum = 0;
        for (let i = 0; i < 12; i++) {
            const d = Number(twelveDigits[i]);
            sum += (i % 2 === 0) ? d : d * 3;
        }
        const mod = sum % 10;
        const check = (10 - mod) % 10;
        return String(check);
    }
}
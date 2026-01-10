import { randomInt } from "crypto";

export function ean13CheckDigit(twelveDigits: string): string {
    let sum = 0;
    for (let i = 0; i < 12; i++) {
        const d = Number(twelveDigits[i]);
        sum += (i % 2 === 0) ? d : d * 3;
    }
    const mod = sum % 10;
    const check = (10 - mod) % 10;
    return String(check);
}

export function generateEan13(): string {
    const prefix = "200"; // внутренний диапазон (как пример)
    let body = "";
    for (let i = 0; i < 9; i++) body += String(randomInt(0, 10));
    const twelve = prefix + body; // 12 digits
    return twelve + ean13CheckDigit(twelve);
}
export function skuToken(value: string | number): string {
    const t = value
        .toString()
        .trim()
        .toUpperCase()
        .normalize("NFKD")
        .replace(/[^\p{L}\p{N}]+/gu, ""); // сохраняет буквы/цифры всех алфавитов
    return t || "ITEM";
}

export function buildSku(productName: string, productCategory: string, attrNames: (string | number)[]) {
    const skuParts = [productName, productCategory, ...attrNames].map(skuToken);
    return skuParts.join("-");
}
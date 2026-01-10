export function skuToken(value: string): string {
    const t = value
        .trim()
        .toUpperCase()
        .normalize("NFKD")
        .replace(/[^A-Z0-9]+/g, ""); // убираем всё кроме A-Z/0-9
    return t || "ITEM";
}

export function buildSku(productName: string, color: string, size: string) {
    return `${skuToken(productName)}-${skuToken(color)}-${skuToken(size)}`;
}
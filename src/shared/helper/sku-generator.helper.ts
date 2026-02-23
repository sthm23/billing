export function skuToken(value: string | number): string {
    const t = value
        .toString()
        .trim()
        .toUpperCase()
        .normalize("NFKD")
        .replace(/[^A-Z0-9]+/g, ""); // убираем всё кроме A-Z/0-9
    return t || "ITEM";
}

export function buildSku(productName: string, productCategory: string, attrNames: (string | number)[]) {
    const skuParts = [productName, productCategory, ...attrNames].map(skuToken);
    return skuParts.join("-");
}
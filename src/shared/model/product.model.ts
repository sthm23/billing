
export type SizeShoes = 35 | 36 | 37 | 38 | 39 | 40 | 41 | 42 | 43 | 44 | 45 | 46;
export type SizeClothes = keyof typeof ProductSizeEnum;
export enum ProductSizeEnum {
    XS = 'XS',
    S = 'S',
    M = 'M',
    L = 'L',
    XL = 'XL',
    XXL = 'XXL',
    XXXL = 'XXXL',
    XXXXL = 'XXXXL',
}

export enum ProductTag {
    NEW_COLLECTION = 'NEW_COLLECTION',
    DISCOUNT = 'DISCOUNT',
    POPULAR = 'POPULAR',
}

export interface ProductSold {
    productId: string;
    sizeId: string;
    colorId: string;
    quantity: number;
    userId: string;
}
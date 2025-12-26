

export interface ProductType {
    _id: string
    name: string
    price: number
    discount: number
    quantity: number
    photo: string[]
    description: string
    category: string
    tag: ProductTag
    brand: string
    isActive: boolean
    sizes: ProductSize[]
}

export type SizeType = ''
export interface ProductSize {
    _id: string
    size: SizeClothes | SizeShoes
    quantity: number
    colors: ProductColor[]
}

export interface ProductColor {
    _id: string
    color: string,
    stock: number,
    sold: number

    userid: string,
    productid: string,
    sizeid: string
}

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
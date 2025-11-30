
export class Product {
    id!: number;

    name!: string

    price!: number

    quantity!: number

    discount!: number

    photo!: string[]

    description!: string

    category!: string

    tag!: string

    brand!: string

    isActive: boolean = true

    sizes: number[] = []
}

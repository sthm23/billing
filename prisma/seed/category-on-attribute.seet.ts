import { Category, PrismaClient } from "../../generated/prisma/client";
import { AttributeEnum } from "./attribute.seed";
import { CategoryEnum } from "./category.seed";


export async function categoryOnAttributes(prisma: PrismaClient, categories: Category[], attrMap: Map<AttributeEnum, string>) {
    const SMARTPHONES = categories.filter(c => c.name === CategoryEnum.SMARTPHONES)!;
    const LAPTOPS = categories.filter(c => c.name === CategoryEnum.LAPTOPS)!;
    const SHIRTS = categories.filter(c => c.name === CategoryEnum.SHIRTS)!;
    const T_SHIRTS = categories.filter(c => c.name === CategoryEnum.T_SHIRTS)!;
    const PANTS = categories.filter(c => c.name === CategoryEnum.PANTS)!;
    const SHOES = categories.filter(c => c.name === CategoryEnum.SHOES)!;
    const SPORTS_WEAR = categories.filter(c => c.name === CategoryEnum.SPORTS_WEAR)!;
    const OUTERWEAR = categories.filter(c => c.name === CategoryEnum.OUTERWEAR)!;
    const UNDERWEAR = categories.filter(c => c.name === CategoryEnum.UNDERWEAR)!;
    const SOCKS = categories.filter(c => c.name === CategoryEnum.SOCKS)!;
    const HATS = categories.filter(c => c.name === CategoryEnum.HATS)!;
    const BEAM = categories.filter(c => c.name === CategoryEnum.BEAM)!;
    const BATTEN = categories.filter(c => c.name === CategoryEnum.BATTEN)!;

    SMARTPHONES.forEach(async category => {
        await prisma.categoriesOnAttribute.createMany({
            data: [
                { categoryId: category.id, attributeId: attrMap.get(AttributeEnum.COLOR)! },
                { categoryId: category.id, attributeId: attrMap.get(AttributeEnum.RAM)! },
                { categoryId: category.id, attributeId: attrMap.get(AttributeEnum.STORAGE)! },
                { categoryId: category.id, attributeId: attrMap.get(AttributeEnum.SCREEN_SIZE)! },
                { categoryId: category.id, attributeId: attrMap.get(AttributeEnum.IS_NEW)! },
            ]
        })
    })
    LAPTOPS.forEach(async category => {
        await prisma.categoriesOnAttribute.createMany({
            data: [
                // LAPTOPS
                { categoryId: category.id, attributeId: attrMap.get(AttributeEnum.RAM)! },
                { categoryId: category.id, attributeId: attrMap.get(AttributeEnum.STORAGE)! },
                { categoryId: category.id, attributeId: attrMap.get(AttributeEnum.SCREEN_SIZE)! },
            ]
        })
    })
    SHIRTS.forEach(async category => {
        await prisma.categoriesOnAttribute.createMany({
            data: [
                // Clothes
                { categoryId: category.id, attributeId: attrMap.get(AttributeEnum.SIZE)! },
                { categoryId: category.id, attributeId: attrMap.get(AttributeEnum.NUMBER_SIZE)! },
                { categoryId: category.id, attributeId: attrMap.get(AttributeEnum.COLOR)! },
                { categoryId: category.id, attributeId: attrMap.get(AttributeEnum.GENDER)! },
            ]
        })
    })
    T_SHIRTS.forEach(async category => {
        await prisma.categoriesOnAttribute.createMany({
            data: [
                // Clothes
                { categoryId: category.id, attributeId: attrMap.get(AttributeEnum.SIZE)! },
                { categoryId: category.id, attributeId: attrMap.get(AttributeEnum.NUMBER_SIZE)! },
                { categoryId: category.id, attributeId: attrMap.get(AttributeEnum.COLOR)! },
                { categoryId: category.id, attributeId: attrMap.get(AttributeEnum.GENDER)! },
            ]
        })
    })
    PANTS.forEach(async category => {
        await prisma.categoriesOnAttribute.createMany({
            data: [
                // Clothes
                { categoryId: category.id, attributeId: attrMap.get(AttributeEnum.SIZE)! },
                { categoryId: category.id, attributeId: attrMap.get(AttributeEnum.NUMBER_SIZE)! },
                { categoryId: category.id, attributeId: attrMap.get(AttributeEnum.COLOR)! },
                { categoryId: category.id, attributeId: attrMap.get(AttributeEnum.GENDER)! },
            ]
        })
    })
    SHOES.forEach(async category => {
        await prisma.categoriesOnAttribute.createMany({
            data: [
                // Clothes
                { categoryId: category.id, attributeId: attrMap.get(AttributeEnum.NUMBER_SIZE)! },
                { categoryId: category.id, attributeId: attrMap.get(AttributeEnum.COLOR)! },
                { categoryId: category.id, attributeId: attrMap.get(AttributeEnum.GENDER)! },
            ]
        })
    })
    SPORTS_WEAR.forEach(async category => {
        await prisma.categoriesOnAttribute.createMany({
            data: [
                // Clothes
                { categoryId: category.id, attributeId: attrMap.get(AttributeEnum.SIZE)! },
                { categoryId: category.id, attributeId: attrMap.get(AttributeEnum.NUMBER_SIZE)! },
                { categoryId: category.id, attributeId: attrMap.get(AttributeEnum.COLOR)! },
                { categoryId: category.id, attributeId: attrMap.get(AttributeEnum.GENDER)! },
            ]
        })
    })
    OUTERWEAR.forEach(async category => {
        await prisma.categoriesOnAttribute.createMany({
            data: [
                // Clothes
                { categoryId: category.id, attributeId: attrMap.get(AttributeEnum.SIZE)! },
                { categoryId: category.id, attributeId: attrMap.get(AttributeEnum.NUMBER_SIZE)! },
                { categoryId: category.id, attributeId: attrMap.get(AttributeEnum.COLOR)! },
                { categoryId: category.id, attributeId: attrMap.get(AttributeEnum.GENDER)! },
            ]
        })
    })
    UNDERWEAR.forEach(async category => {
        await prisma.categoriesOnAttribute.createMany({
            data: [
                // Clothes
                { categoryId: category.id, attributeId: attrMap.get(AttributeEnum.SIZE)! },
                { categoryId: category.id, attributeId: attrMap.get(AttributeEnum.NUMBER_SIZE)! },
                { categoryId: category.id, attributeId: attrMap.get(AttributeEnum.COLOR)! },
                { categoryId: category.id, attributeId: attrMap.get(AttributeEnum.GENDER)! },
            ]
        })
    })
    SOCKS.forEach(async category => {
        await prisma.categoriesOnAttribute.createMany({
            data: [
                // Clothes
                { categoryId: category.id, attributeId: attrMap.get(AttributeEnum.SIZE)! },
                { categoryId: category.id, attributeId: attrMap.get(AttributeEnum.NUMBER_SIZE)! },
                { categoryId: category.id, attributeId: attrMap.get(AttributeEnum.COLOR)! },
                { categoryId: category.id, attributeId: attrMap.get(AttributeEnum.GENDER)! },
            ]
        })
    })
    HATS.forEach(async category => {
        await prisma.categoriesOnAttribute.createMany({
            data: [
                // Clothes
                { categoryId: category.id, attributeId: attrMap.get(AttributeEnum.SIZE)! },
                { categoryId: category.id, attributeId: attrMap.get(AttributeEnum.NUMBER_SIZE)! },
                { categoryId: category.id, attributeId: attrMap.get(AttributeEnum.COLOR)! },
                { categoryId: category.id, attributeId: attrMap.get(AttributeEnum.GENDER)! },
            ]
        })
    })
    BEAM.forEach(async category => {
        await prisma.categoriesOnAttribute.createMany({
            data: [
                // Lumber (Beam, BATTEN, etc.)
                { categoryId: category.id, attributeId: attrMap.get(AttributeEnum.WOOD_SPECIES)! },
                { categoryId: category.id, attributeId: attrMap.get(AttributeEnum.LUMBER_SIZE)! },
                { categoryId: category.id, attributeId: attrMap.get(AttributeEnum.LENGTH)! },
            ]
        })
    })
    BATTEN.forEach(async category => {
        await prisma.categoriesOnAttribute.createMany({
            data: [
                // Lumber (Beam, BATTEN, etc.)
                { categoryId: category.id, attributeId: attrMap.get(AttributeEnum.WOOD_SPECIES)! },
                { categoryId: category.id, attributeId: attrMap.get(AttributeEnum.LUMBER_SIZE)! },
                { categoryId: category.id, attributeId: attrMap.get(AttributeEnum.LENGTH)! },
            ]
        })
    })
}
import { PipeTransform, Injectable, ArgumentMetadata, BadRequestException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { set } from '../helper/parse-obj.helper';
import { ProductSizeDTO } from '../dto/product-size.dto';

@Injectable()
export class ValidateSizePipe implements PipeTransform<any> {
    async transform(value: any, { metatype }: ArgumentMetadata) {
        if (!metatype || !this.toValidate(metatype)) {
            return value;
        }

        if (value.sizes && value.sizes.length) {
            const validateObj = { ...value }
            const data = {};
            for (const key in validateObj) {
                if (validateObj.hasOwnProperty(key)) {
                    set(data, key, value[key]);
                }
            }
            // Преобразуем JSON в экземпляр DTO
            const dto = plainToInstance(metatype, data);
            const errors = await validate(ProductSizeDTO.name, dto?.sizes);

            if (errors.length > 0) {
                throw new BadRequestException('Validation of sizes failed!');
            }

            return dto;
        } else {
            return value;
        }
    }

    private toValidate(metatype: Function): boolean {
        const types: Function[] = [String, Boolean, Number, Array, Object];
        return !types.includes(metatype);
    }
}
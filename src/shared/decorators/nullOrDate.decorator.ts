import { registerDecorator, ValidationOptions, ValidationArguments } from 'class-validator';

export function NullOrDate(property?: string, validationOptions?: ValidationOptions) {
    return function (object: Object, propertyName: string) {
        registerDecorator({
            name: 'NullOrDate',
            target: object.constructor,
            propertyName: propertyName,
            constraints: [property],
            options: { ...validationOptions, message: 'Value must be a valid date or null' },
            validator: {
                validate(value: null | Date) {
                    if (value === null) {
                        return true; // null is valid
                    }
                    const date = new Date(value);
                    return !isNaN(date.getTime()); // Check if the date is valid
                },
            },
        });
    };
}


export function NullOrString(property?: string, validationOptions?: ValidationOptions) {
    return function (object: Object, propertyName: string) {
        registerDecorator({
            name: 'NullOrString',
            target: object.constructor,
            propertyName: propertyName,
            constraints: [property],
            options: { ...validationOptions, message: 'Value must be a valid string or null' },
            validator: {
                validate(value: null | string) {
                    if (value === null) {
                        return true; // null is valid
                    }
                    return typeof value === 'string'
                },
            },
        });
    };
}
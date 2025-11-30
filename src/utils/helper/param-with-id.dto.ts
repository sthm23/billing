
import { Transform } from 'class-transformer';
import { IsNumber } from 'class-validator';

class ParamsWithId {
    @Transform(({ value }) => parseInt(value, 10))
    @IsNumber()
    id!: number;
}

export default ParamsWithId;
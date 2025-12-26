
import { Transform } from 'class-transformer';
import { IsUUID } from 'class-validator';

class ParamsWithId {
    @Transform(({ value }) => parseInt(value, 10))
    @IsUUID()
    id!: string;
}

export default ParamsWithId;
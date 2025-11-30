
import { IsNumber } from 'class-validator';

class ParamsWithId {
    @IsNumber()
    id!: number;
}

export default ParamsWithId;
import { Global, Module } from '@nestjs/common';
import { BarcodeService } from './helper/bar-code.service';

@Global()
@Module({
    providers: [BarcodeService],
    exports: [BarcodeService],
})
export class SharedModule { }

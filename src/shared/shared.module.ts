import { Global, Module } from '@nestjs/common';
import { UserHelperService } from './services/user/user-helper.service';

@Global()
@Module({
    providers: [UserHelperService],
    exports: [UserHelperService],
})
export class SharedModule { }

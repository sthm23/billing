import { Injectable, OnModuleInit } from '@nestjs/common';
import { ROLE } from '@utils/model/role.model';
import { UserService } from '@user/user.service';


@Injectable()
export class SuperUserService implements OnModuleInit {
    constructor(private userService: UserService) { }

    async onModuleInit() {
        const existingSuperUser = await this.userService.findOneByLogin('admin');

        if (!existingSuperUser) {
            console.log('Создаю суперпользователя...');

            const superUser = {
                login: 'admin',
                password: 'test',
                name: 'Sanjar Tukhtamishev',
                company: 'sthm23',
                role: ROLE.ADMIN,
                phoneNumber: '+998777377177'
            };
            await this.userService.create(superUser);
            console.log('Суперпользователь создан.');
        } else {
            console.log('Суперпользователь уже существует.');
        }
    }
}

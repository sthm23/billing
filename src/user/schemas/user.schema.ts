
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { ROLE } from '@utils/model/role.model';

@Schema({
    timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
    id: true,
    versionKey: false
})
export class User {
    id: string

    @Prop({ type: String })
    name: string;

    @Prop({ type: String })
    phoneNumber: string;

    @Prop({ unique: true, required: true })
    login: string;

    @Prop({ required: true, minlength: 3 })
    password: string;

    @Prop({ enum: ROLE, default: ROLE.USER })
    role: ROLE;

    @Prop({ default: '' })
    company: string;
}

export type UserDocument = HydratedDocument<User>;
export const UserSchema = SchemaFactory.createForClass(User);
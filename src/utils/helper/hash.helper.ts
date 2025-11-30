import * as bcrypt from 'bcrypt';


export class HashingHelper {

    static async hash(text: string, salt: number) {
        return await bcrypt.hash(text, salt);
    }

    static async isMatch(text: string, hash: string) {
        return await bcrypt.compare(text, hash)
    }
}
import { ROLE } from "./role.model"


export interface UserType {
    id: string
    login: string
    password: string
    name: string
    role: ROLE
    company: string
    createAt: string
    updateAt: string
}
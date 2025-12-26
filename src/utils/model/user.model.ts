import { StaffRole } from "@generated/enums"



export interface UserType {
    id: string
    login: string
    password: string
    name: string
    role: StaffRole
    company: string
    createAt: string
    updateAt: string
}
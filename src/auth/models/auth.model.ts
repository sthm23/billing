import { Admin, User, AuthAccount } from "@generated/client"



export interface JWTPayload {
    sub: string
    login: string
}

export interface LoginResponse {
    refreshToken?: string
    accessToken: string
}

export type UserAuth = User & { auth: AuthAccount }
export type UserAdmin = User & { admin: Admin }
export type UserWithAuthAndAdmin = User & { auth: AuthAccount, admin: Admin }
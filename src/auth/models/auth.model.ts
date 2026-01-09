import { Admin, User, AuthAccount, Staff } from "@generated/client"

export interface AccessTokenPayload {
    sub: string // userId
    sid: string, // authAccountId
    type: 'access'
}

export interface RefreshTokenPayload {
    sub: string, // userId
    type: 'refresh'
}

export interface LoginResponse {
    accessToken: string
    refreshToken?: string
}

export type UserAuth = User & { auth: AuthAccount }
export type UserAdmin = User & { admin: Admin }
export type UserWithAuthAndAdmin = User & { auth: AuthAccount, admin: Admin }
export type CurrentUserType = UserWithAuthAndAdmin & { staff: Staff } 
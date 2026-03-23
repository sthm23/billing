import { User, AuthAccount, Staff, Warehouse } from "@generated/client"

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
type StaffWarehouse = Staff & { warehouse: { warehouseId: string }[] }
export type CurrentUser = User & { auth: AuthAccount, staff: StaffWarehouse }
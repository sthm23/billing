import { StaffRole } from "@generated/enums"



export interface JWTPayload {
    userId: string
    role: StaffRole
    company: string
}

export interface AuthTokenType {
    refreshToken: string
    accessToken: string
}
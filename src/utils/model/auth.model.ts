import { ROLE } from "@generated/enums"



export interface JWTPayload {
    userId: string
    role: ROLE
    company: string
}

export interface AuthTokenType {
    refreshToken: string
    accessToken: string
}
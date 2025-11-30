import { ROLE } from "@generated/enums"


export interface JWTPayload {
    userId: number
    role: ROLE
    company: string
}

export interface AuthTokenType {
    refreshToken: string
    accessToken: string
}
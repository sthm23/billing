import { ROLE } from "@utils/model/role.model"

export interface JWTPayload {
    userId: string
    role: ROLE
    company: string
}

export interface AuthTokenType {
    refreshToken: string
    accessToken: string
}
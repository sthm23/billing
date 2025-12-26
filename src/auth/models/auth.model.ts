


export interface JWTPayload {
    userId: number
    company: string
}

export interface AuthTokenType {
    refreshToken: string
    accessToken: string
}
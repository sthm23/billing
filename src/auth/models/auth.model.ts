


export interface JWTPayload {
    userid: string
    company: string
}

export interface AuthTokenType {
    refreshToken: string
    accessToken: string
}
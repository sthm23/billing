


export interface PaymentDetails {
    _id: string;
    paid: Payment[];
    orderId: string
    debt: number;
    amount: number;
    status: PaymentStatus;
    payOffDate: Date | null; // Date when the payment is fully paid off
    createdAt: Date;
}

export interface Payment {
    _id: string;
    amount: number;
    createdAt: Date;
    method: PaymentMethod; // e.g., 'CASH', 'CARD', etc.
}

export enum PaymentStatus {
    HALF = 'HALF',
    PAID = 'PAID',
    CANCELED = 'CANCELED',
}

export enum PaymentMethod {
    CASH = 'CASH',
    CARD = 'CARD',
    ONLINE = 'ONLINE',
    OTHER = 'OTHER' // For any other payment methods not listed
}
export enum Currency {
    USD = 'USD',
    EUR = 'EUR',
    RUB = 'RUB',
    SUM = 'SUM',
}
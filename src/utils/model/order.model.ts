import { PaymentDetails } from "./payment.model";


export interface OrderType {
    id: string;
    status: ORDER_STATUS;
    userId: string | null;
    creatorId: string;
    phoneNumber: string;
    name: string;
    promoCodeId: string | null;
    totalDiscount: number;
    totalPrice: number;
    orders: OrderItem[];
    payment: PaymentDetails | null;
}

export interface OrderItem {
    id: string
    productId: string
    name: string
    photo: string | null
    price: number,
    discount: number,
    quantity: number,
    size: string
    color: string
}

export enum ORDER_STATUS {
    PENDING = 'PENDING',
    INPROGRESS = 'INPROGRESS',
    CANCEL = 'CANCEL',
    COMPLETE = 'COMPLETE',
}
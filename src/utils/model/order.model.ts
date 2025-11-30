import { ClientSession } from "mongoose";
import { PaymentDetails } from "./payment.model";
import { OrderItemDTO } from "src/order/dto/order-item.dto";


export interface OrderType {
    _id: string;
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
    _id: string
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

export interface UpdateOrderStatusOption { status: ORDER_STATUS, userId: string, paymentId?: string, session?: ClientSession }
export interface CreateOrderItemType {
    orders: OrderItemDTO[]
    userId: string,
    session: ClientSession
}
import { PRICE_TABLE } from '../../config/prices';

/** Bike trail pass price (recreation revenue). Bikes need gear: rental flag via Rental.ownsGear(id, 'bike'). */
export const mtbFee = (): number => PRICE_TABLE.mtbTrail!.price;
export const hikeFee = (): number => PRICE_TABLE.hiking!.price;

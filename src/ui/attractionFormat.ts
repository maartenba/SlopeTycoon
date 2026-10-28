import type { AttractionInfo } from '@/sim/attractions/Attraction';
import { formatMoney } from './format';
import { sentence } from './text';

export function formatPriceLabel(price: number, billing: AttractionInfo['billing']): string {
  const unit = billing === 'perHour' ? '/hour' : billing === 'perNight' ? '/night' : '/use';
  return `${formatMoney(price)}${unit}`;
}

export function formatStaff(staff: number, required: number): string {
  if (required <= 0) return 'Staff: none needed';
  const tag = staff < required ? ' (understaffed: reduced capacity)' : staff > required ? ' (extra: faster service)' : '';
  return `Staff: ${staff}/${required}${tag}`;
}

/** Inspector lines for an attraction: status/reason, usage, queue, price, staff, revenue. */
export function formatAttractionStats(i: AttractionInfo): string[] {
  return [
    i.open ? 'Open' : sentence(i.reason ?? 'Closed'),
    `In use ${i.users}/${i.capacity} · Queue ${i.queue}`,
    `Guests served: ${i.served}${i.balked + i.reneged > 0 ? ` (${i.balked + i.reneged} gave up)` : ''}`,
    `Revenue: ${formatMoney(i.revenue)}`,
    ...(i.busiestHour ? [`Busiest hour: ${String(i.busiestHour.hour).padStart(2, '0')}:00 (${Math.round(i.busiestHour.share * 100)}% of revenue)`] : []),
    `Price: ${formatPriceLabel(i.price, i.billing)}`,
    formatStaff(i.staff, i.staffRequired),
    `Upkeep incl. wages: ${formatMoney(i.upkeepPerDay)}/day`,
    ...(i.toilet ? [`Used today: ${i.toilet.usesToday}/${i.toilet.perDay} · ${i.toilet.usesToday > i.toilet.perDay ? 'overrun: add more toilets' : 'clean'}`] : []),
    ...(i.beds ? [`Trekker beds: ${i.beds.used}/${i.beds.total} booked tonight · ${i.beds.sold} nights sold`] : []),
  ];
}

import { describe, expect, it } from 'vitest';
import {
  CURRENCY,
  formatMoney,
  formatMoneyDelta,
  fromNaira,
  KOBO_PER_NAIRA,
  parseMoneyToKobo,
  sumLineTotals,
  toNaira,
} from '@/lib/money';

describe('formatMoney', () => {
  it('renders kobo as a Nigerian naira string', () => {
    expect(formatMoney(1850000)).toBe('₦18,500.00');
    expect(formatMoney(750000)).toBe('₦7,500.00');
    expect(formatMoney(0)).toBe('₦0.00');
    expect(formatMoney(50)).toBe('₦0.50');
  });

  it('groups thousands the way en-NG does', () => {
    // Twelve million naira is 1,200,000,000 kobo: the first group is three
    // digits in en-NG, not the South Asian lakh grouping.
    expect(formatMoney(1200000000)).toBe('₦12,000,000.00');
  });

  it('drops the decimals in compact mode', () => {
    expect(formatMoney(1850000, { compact: true })).toBe('₦18,500');
    expect(formatMoney(50, { compact: true })).toBe('₦1');
  });

  it('never renders NaN on a price', () => {
    expect(formatMoney(Number.NaN)).toBe('—');
    expect(formatMoney(Number.POSITIVE_INFINITY)).toBe('—');
  });

  it('uses NGN, not USD', () => {
    expect(CURRENCY).toBe('NGN');
    expect(formatMoney(10000)).toContain('₦');
  });
});

describe('naira <-> kobo conversion', () => {
  it('uses 100 kobo per naira', () => {
    expect(KOBO_PER_NAIRA).toBe(100);
  });

  it('converts in both directions without drift', () => {
    expect(toNaira(1850000)).toBe(18500);
    expect(fromNaira(18500)).toBe(1850000);
    expect(fromNaira(toNaira(1234567))).toBe(1234567);
  });

  it('rounds to whole kobo rather than producing a fraction', () => {
    expect(fromNaira(18.505)).toBe(1851);
    expect(toNaira(1850.4)).toBe(18.5);
  });
});

describe('parseMoneyToKobo', () => {
  it('round-trips every value formatMoney can produce', () => {
    for (const kobo of [0, 50, 750000, 1850000, 52000000]) {
      expect(parseMoneyToKobo(formatMoney(kobo))).toBe(kobo);
    }
  });

  it('reads what a human actually types', () => {
    // Bare digits are naira: kobo only exists in the database.
    expect(parseMoneyToKobo('18500')).toBe(1850000);
    expect(parseMoneyToKobo('18,500.00')).toBe(1850000);
    expect(parseMoneyToKobo('₦18,500.00')).toBe(1850000);
    expect(parseMoneyToKobo('₦ 18 500')).toBe(1850000);
    expect(parseMoneyToKobo('NGN18,500.00')).toBe(1850000);
    expect(parseMoneyToKobo('18,500')).toBe(1850000);
    expect(parseMoneyToKobo('18.5')).toBe(1850);
  });

  it('reads a half-typed value without losing the integer part', () => {
    expect(parseMoneyToKobo('18,500.')).toBe(1850000);
    expect(parseMoneyToKobo('18.')).toBe(1800);
  });

  it('reads accounting parentheses as negative', () => {
    expect(parseMoneyToKobo('(18,500.00)')).toBe(-1850000);
  });

  it('truncates beyond two decimal places rather than rounding a currency up', () => {
    // 18.509 naira is 1850 kobo. Rounding would make it 1851.
    expect(parseMoneyToKobo('18.509')).toBe(1850);
  });

  it('returns null rather than guessing', () => {
    expect(parseMoneyToKobo('')).toBeNull();
    expect(parseMoneyToKobo('   ')).toBeNull();
    expect(parseMoneyToKobo('naira')).toBeNull();
    expect(parseMoneyToKobo('₦')).toBeNull();
  });
});

describe('formatMoneyDelta', () => {
  it('signs a change and zeroes out to an em dash', () => {
    expect(formatMoneyDelta(120000)).toBe('+₦1,200.00');
    expect(formatMoneyDelta(-120000)).toBe('−₦1,200.00');
    expect(formatMoneyDelta(0)).toBe('—');
  });
});

describe('sumLineTotals', () => {
  it('multiplies quantity by unit price in integer kobo', () => {
    expect(
      sumLineTotals([
        { quantity: 2, unitPriceKobo: 750000 },
        { quantity: 1, unitPriceKobo: 1850000 },
      ]),
    ).toBe(3350000);
  });

  it('sums an empty cart to zero', () => {
    expect(sumLineTotals([])).toBe(0);
  });

  it('never produces a fractional kobo', () => {
    expect(Number.isInteger(sumLineTotals([{ quantity: 3, unitPriceKobo: 1850000 }]))).toBe(true);
  });
});

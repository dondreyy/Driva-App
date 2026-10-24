/** All money is integer kobo. 100 kobo = N1. Never use floats for amounts. */
export type Kobo = number;

export const KOBO_PER_NAIRA = 100;

export function naira(amount: number): Kobo {
  if (!Number.isInteger(amount)) {
    throw new RangeError(`naira() takes whole naira, got ${amount}`);
  }
  return amount * KOBO_PER_NAIRA;
}

export function assertKobo(value: number, label = 'amount'): asserts value is Kobo {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be an integer number of kobo, got ${value}`);
  }
}

/** Rounds a non-negative kobo amount to the nearest multiple of `step`, halves going up. */
export function roundToNearest(value: Kobo, step: Kobo): Kobo {
  assertKobo(value);
  assertKobo(step, 'step');
  return Math.floor((value + step / 2) / step) * step;
}

/** Formats kobo for display, for example 700000 -> "N7,000". */
export function formatNaira(value: Kobo): string {
  assertKobo(value);
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  const whole = Math.floor(abs / KOBO_PER_NAIRA).toLocaleString('en-NG');
  const rest = abs % KOBO_PER_NAIRA;
  return `${sign}₦${whole}${rest ? `.${String(rest).padStart(2, '0')}` : ''}`;
}

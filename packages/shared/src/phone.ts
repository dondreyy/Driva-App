/**
 * Nigerian mobile numbers. Accepts the usual ways people type them
 * ("0803 555 0142", "+234 803 555 0142", "2348035550142") and returns E.164,
 * or null when it is not a Nigerian mobile number.
 */
export function normalizeNigerianPhone(input: string): string | null {
  const digits = input.replace(/[\s\-().]/g, '');
  const match = /^(?:\+?234|0)([789][01]\d{8})$/.exec(digits);
  return match ? `+234${match[1]}` : null;
}

/** Hides all but the last four digits, for logs and screens that do not need the number. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length <= 4) return '****';
  return `${phone.startsWith('+') ? '+' : ''}${'*'.repeat(digits.length - 4)}${digits.slice(-4)}`;
}

/** "+2348035550142" -> "0803 555 0142" for display to the number's owner. */
export function formatNigerianPhone(e164: string): string {
  const local = `0${e164.replace(/^\+234/, '')}`;
  return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
}

export * from './workflow';
export * from './api';

/** Normalises a phone number to WhatsApp's wa_id form: digits only, no leading +. */
export function normalizeWaId(input: string): string {
  return input.replace(/\D/g, '');
}

/** Formats minor currency units (paise/cents) for display. */
export function formatMoney(minor: number, currency = 'INR'): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(
    minor / 100,
  );
}

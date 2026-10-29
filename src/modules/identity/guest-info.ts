import { ValidationError } from '@/lib/errors';

/**
 * The hotel facts a guest reads (D-087), and the rules for what may be stored.
 * Pure — no database — so `property-profile.ts` and the unit tests share one
 * definition of a valid phone number.
 */

export interface GuestInfo {
  contactPhone: string | null;
  contactWhatsapp: string | null;
  contactEmail: string | null;
  addressLine: string | null;
  city: string | null;
  /** `HH:MM`, property-local. */
  checkInTime: string | null;
  checkOutTime: string | null;
  wifiNetwork: string | null;
  wifiPassword: string | null;
}

/**
 * Validate a guest-info form. Pure, so the rules are unit-tested without a
 * database. Every field is optional, and a blank one is stored as NULL — the
 * guest app shows nothing rather than "not set".
 */
export function cleanGuestInfo(input: Partial<Record<keyof GuestInfo, string | null>>): GuestInfo {
  return {
    contactPhone: cleanPhone(input.contactPhone, 'The front desk number'),
    contactWhatsapp: cleanPhone(input.contactWhatsapp, 'The WhatsApp number'),
    contactEmail: cleanEmail(input.contactEmail),
    addressLine: cleanText(input.addressLine, 'The address', 200),
    city: cleanText(input.city, 'The city', 80),
    checkInTime: cleanTime(input.checkInTime, 'Check-in'),
    checkOutTime: cleanTime(input.checkOutTime, 'Check-out'),
    wifiNetwork: cleanText(input.wifiNetwork, 'The wifi name', 64),
    wifiPassword: cleanText(input.wifiPassword, 'The wifi password', 128),
  };
}

/** Digits, spaces, dashes, brackets and one leading +. Stored as typed. */
function cleanPhone(value: string | null | undefined, label: string): string | null {
  const phone = value?.trim();
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (!/^\+?[\d\s()-]+$/.test(phone) || digits.length < 6 || digits.length > 15) {
    throw new ValidationError(`${label} does not look like a phone number. Include the country code, like +91 294 123 4567.`);
  }
  return phone;
}

function cleanEmail(value: string | null | undefined): string | null {
  const email = value?.trim();
  if (!email) return null;
  if (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ValidationError('That email address does not look right.');
  }
  return email;
}

function cleanTime(value: string | null | undefined, label: string): string | null {
  const time = value?.trim();
  if (!time) return null;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new ValidationError(`${label} is a time like 14:00.`);
  }
  return time;
}

function cleanText(value: string | null | undefined, label: string, max: number): string | null {
  const text = value?.trim();
  if (!text) return null;
  if (text.length > max) throw new ValidationError(`${label} is too long (${max} characters at most).`);
  return text;
}

/** The number a `tel:` or `wa.me` link wants: digits, with a + kept for tel. */
export function dialable(phone: string): { tel: string; whatsapp: string } {
  const digits = phone.replace(/\D/g, '');
  return { tel: `${phone.trim().startsWith('+') ? '+' : ''}${digits}`, whatsapp: digits };
}

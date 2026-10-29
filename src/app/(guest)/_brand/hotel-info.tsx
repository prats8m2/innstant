import { Clock, Mail, MapPin, MessageCircle, Phone, Wifi } from 'lucide-react';
import { dialable, type GuestInfo } from '@/modules/identity/guest-info';
import { formatClock } from '@/lib/clock';
import { CopyButton } from './copy-button';
import styles from './hotel-info.module.css';

/**
 * The answers to what a guest would otherwise ring the desk for: the wifi,
 * when they arrive and leave, and how to reach a person (D-087).
 *
 * Each row exists only when the hotel filled it in — a guest is never shown
 * "Wi-Fi: not set". With nothing filled in, the whole section is absent.
 *
 * The wifi password is passed in only from a ROOM session's screen. A
 * property link is a table tent or an Instagram bio, and the password does not
 * belong on either.
 */
export function HotelInfo({
  info,
  showWifiPassword,
}: {
  info: GuestInfo;
  showWifiPassword: boolean;
}) {
  const phone = info.contactPhone ? dialable(info.contactPhone) : null;
  const whatsapp = info.contactWhatsapp ? dialable(info.contactWhatsapp) : null;
  const address = [info.addressLine, info.city].filter(Boolean).join(', ');
  const times = [
    info.checkInTime ? `Check-in from ${formatClock(info.checkInTime)}` : null,
    info.checkOutTime ? `check-out by ${formatClock(info.checkOutTime)}` : null,
  ].filter(Boolean).join(' · ');

  const hasAnything = info.wifiNetwork || phone || whatsapp || info.contactEmail || address || times;
  if (!hasAnything) return null;

  return (
    <section className={styles.section} aria-labelledby="hotel-info-heading">
      <h2 id="hotel-info-heading" className={styles.title}>The hotel</h2>

      {info.wifiNetwork ? (
        <div className={styles.wifi}>
          <Wifi className={styles.icon} size={20} strokeWidth={1.75} aria-hidden="true" />
          <div className={styles.wifiBody}>
            <p className={styles.label}>Wi-Fi</p>
            <p className={styles.value}>{info.wifiNetwork}</p>
            {showWifiPassword && info.wifiPassword ? (
              <p className={styles.password}>
                <span className={styles.passwordValue}>{info.wifiPassword}</span>
                <CopyButton value={info.wifiPassword} label="Copy the Wi-Fi password" />
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {phone || whatsapp ? (
        <div className={styles.actions}>
          {phone ? (
            <a className={styles.action} href={`tel:${phone.tel}`}>
              <Phone size={18} strokeWidth={1.75} aria-hidden="true" />
              Call the desk
            </a>
          ) : null}
          {whatsapp ? (
            <a
              className={styles.action}
              href={`https://wa.me/${whatsapp.whatsapp}`}
              target="_blank"
              rel="noreferrer"
            >
              <MessageCircle size={18} strokeWidth={1.75} aria-hidden="true" />
              WhatsApp
            </a>
          ) : null}
        </div>
      ) : null}

      <ul className={styles.facts}>
        {times ? (
          <li className={styles.fact}>
            <Clock className={styles.icon} size={18} strokeWidth={1.75} aria-hidden="true" />
            <span>{times}</span>
          </li>
        ) : null}
        {info.contactEmail ? (
          <li className={styles.fact}>
            <Mail className={styles.icon} size={18} strokeWidth={1.75} aria-hidden="true" />
            <a href={`mailto:${info.contactEmail}`}>{info.contactEmail}</a>
          </li>
        ) : null}
        {address ? (
          <li className={styles.fact}>
            <MapPin className={styles.icon} size={18} strokeWidth={1.75} aria-hidden="true" />
            <span>{address}</span>
          </li>
        ) : null}
      </ul>
    </section>
  );
}

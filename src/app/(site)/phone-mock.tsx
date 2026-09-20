import styles from './site.module.css';

/**
 * The hero's picture: a phone showing the guest app, with a kitchen ticket and
 * a folio floating off it.
 *
 * Built rather than screenshotted, for the reason CLAUDE.md gives about the
 * design reference — "match the reference, but rebuild it with real
 * components". A PNG of the guest home would need re-exporting every time the
 * arch, the tile grid or the greeting changes, and would be wrong for months
 * before anybody noticed.
 *
 * Everything in it is taken from the seeded demo property, so the numbers on
 * the page and the numbers a visitor sees one click later are the same ones:
 * room 214, Anjali Menon, order KE-1184, ₹2,266.
 *
 * `aria-hidden` on the whole thing. It is an illustration of screens described
 * in words directly beside it; read aloud it is forty fragments of a menu.
 */
export function PhoneMock() {
  return (
    <div className={styles.heroArt} aria-hidden="true">
      <div className={styles.heroArtSlab} />

      <div className={styles.phone}>
        <div className={styles.phoneBody}>
          <div className={styles.phoneTop}>
            <span className={styles.phoneHotel}>The Kesari</span>
            <span className={styles.phoneRoom}>ROOM 214</span>
          </div>

          {/* The jharokha arch, the same shape the real guest home draws. */}
          <div className={styles.phoneArch}>
            <span className={styles.phoneArchWash} />
            <span className={styles.phoneArchLine}>Kitchen open until 11:30</span>
          </div>

          <p className={styles.phoneGreeting}>Good evening, Anjali</p>
          <p className={styles.phoneStay}>Room 214 is yours until Thursday, 11am.</p>

          <ul className={styles.phoneTiles}>
            {['Amenities', 'Message the front desk', 'Your stay', 'Udaipur after dark'].map((tile) => (
              <li key={tile} className={styles.phoneTile}>
                <span>{tile}</span>
                <span>→</span>
              </li>
            ))}
          </ul>
        </div>

        <div className={styles.phoneCta}>Order dinner to room 214</div>
      </div>

      <div className={styles.ticket}>
        <div className={styles.ticketHead}>
          <span className={styles.ticketRoom}>214</span>
          <span className={styles.ticketWho}>
            <span className={styles.ticketName}>Anjali Menon</span>
            <span className={styles.ticketRef}>KE-1184 · 21:42</span>
          </span>
          <span className={styles.ticketAge}>01:12</span>
        </div>
        <ul className={styles.ticketLines}>
          <li><span className={styles.ticketQty}>1×</span> Laal maas with bajra roti</li>
          <li><span className={styles.ticketQty}>2×</span> Kesar lassi</li>
        </ul>
        <div className={styles.ticketAction}>Accept · start cooking</div>
      </div>

      <div className={styles.folio}>
        <p className={styles.folioHead}>
          <span className={styles.folioDot} />
          Folio · room 214
        </p>
        <p className={styles.folioLine}>
          <span>In-room dining · KE-1184</span>
          <span className="tabular">₹2,266</span>
        </p>
        <p className={styles.folioLine}>
          <span>Late checkout to 2pm</span>
          <span className="tabular">₹2,500</span>
        </p>
        <p className={styles.folioTotal}>
          <span>Total so far</span>
          <span className="tabular">₹13,706</span>
        </p>
      </div>
    </div>
  );
}

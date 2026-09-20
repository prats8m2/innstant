import Link from 'next/link';
import { InnstantLogo, InnstantMark } from '@/components/innstant-logo';
import { NAV, PILLARS, STEPS, REVENUE, THEMES, SECURITY, QUOTES } from './content';
import { DemoRequestForm } from './demo-request-form';
import { PhoneMock } from './phone-mock';
import styles from './site.module.css';

/**
 * The front door.
 *
 * ─── One page, not five ────────────────────────────────────────────────────
 *
 * The design export is a five-screen app: Home, Product, Themes, Security and
 * Contact, switched by `setState` with the scroll reset to the top each time.
 * That is how a design tool has to model a multi-page site — it has no router.
 * We do, and using it would mean five routes, five layouts and four more
 * chances for the nav to disagree with the page.
 *
 * It is one document with four anchors instead, which is what the content
 * actually is: a single argument read top to bottom, where "Security" is a
 * section somebody jumps to rather than a destination. It also means the
 * whole thing is one static render with no client JavaScript except the form —
 * a marketing page that ships a router to show six paragraphs is the thing the
 * product is selling against.
 *
 * The one screen from the export that is NOT here is Product's surface
 * switcher, which mocks up the KDS, the runner and the desk in HTML. Those
 * screens exist — `/kds`, `/runner`, `/admin` — and a drawing of a real screen
 * goes stale the week somebody changes it. "See how it works" opens the real
 * one instead.
 */
export default function SitePage() {
  return (
    <>
      <SiteNav />

      <main id="top">
        <Hero />
        <Trusted />
        <Pillars />
        <HowItWorks />
        <Revenue />
        <Quotes />
        <Security />
        <Contact />
      </main>

      <SiteFooter />
    </>
  );
}

/* ── Nav ──────────────────────────────────────────────────────────────────── */

function SiteNav() {
  return (
    <header className={styles.nav}>
      <div className={styles.navInner}>
        <Link href="#top" className={styles.navBrand} aria-label="Innstant, back to top">
          <InnstantLogo size={26} />
        </Link>

        <nav className={styles.navLinks} aria-label="Sections">
          {NAV.map((item) => (
            <a key={item.href} href={item.href} className={styles.navLink}>
              {item.label}
            </a>
          ))}
        </nav>

        <div className={styles.navActions}>
          {/* The real console, not a marketing page about it. */}
          <Link href="/admin" className={styles.navSignIn}>Staff sign in</Link>
          <a href="#contact" className={styles.navCta}>Book a demo</a>
        </div>
      </div>
    </header>
  );
}

/* ── Hero ─────────────────────────────────────────────────────────────────── */

function Hero() {
  return (
    <section className={styles.hero}>
      <div className={styles.heroCopy}>
        <h1 className={styles.heroTitle}>
          Digitise your <em>guest experience.</em>
        </h1>

        <p className={styles.heroBody}>
          Innstant gives every hotel guest a personal concierge on their own
          phone. They order dinner, ask for towels, reach the desk and extend
          their stay in a few taps. Your kitchen, housekeeping and reception see
          it the moment it happens.
        </p>

        <div className={styles.heroActions}>
          <a href="#contact" className={styles.primaryCta}>Book a 20-minute demo</a>
          {/*
            The one link on this page that goes somewhere real. `/demo` asks
            what to call the visitor, then opens the seeded property as a guest
            — the actual product, not a screenshot of it.
          */}
          <Link href="/demo" className={styles.secondaryCta}>See how it works</Link>
        </div>

        <dl className={styles.heroStats}>
          <Stat value="2 s" label="Scan to first screen" />
          <Stat value="3 taps" label="Dinner to the room" />
          <Stat value="0" label="Apps installed, passwords set" />
        </dl>
      </div>

      <PhoneMock />
    </section>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className={styles.stat}>
      <dt className={styles.statValue}>{value}</dt>
      <dd className={styles.statLabel}>{label}</dd>
    </div>
  );
}

/* ── The logo strip ───────────────────────────────────────────────────────── */

function Trusted() {
  return (
    <div className={styles.wrap}>
      <div className={styles.trusted}>
        {/*
          Said plainly. The six names below are the demonstration properties
          from the design system — they are what a theme looks like, not a
          customer list, and the line says "designed for" rather than "trusted
          by" because the second one would not be true yet.
        */}
        <span className={styles.trustedLabel}>
          Designed for independent properties across India
        </span>
        <ul className={styles.trustedList}>
          {THEMES.map((theme) => (
            <li key={theme.key} className={styles.trustedName}>{theme.name}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ── What it is ───────────────────────────────────────────────────────────── */

function Pillars() {
  return (
    <section className={styles.wrap} id="product">
      <div className={styles.sectionHead}>
        <p className={styles.kicker}>What it is</p>
        <h2 className={styles.sectionTitle}>
          Everything a guest asks for between check-in and checkout, on the
          phone they already have.
        </h2>
      </div>

      <div className={styles.pillars}>
        {PILLARS.map((pillar) => (
          <article key={pillar.kicker} className={styles.pillar}>
            <div className={styles.pillarHead}>
              <span className={styles.pillarKicker}>{pillar.kicker}</span>
              <span className={styles.pillarShape} data-shape={pillar.shape} aria-hidden="true" />
            </div>
            <h3 className={styles.pillarTitle}>{pillar.title}</h3>
            <p className={styles.pillarBody}>{pillar.body}</p>
            <p className={styles.pillarFoot}>{pillar.foot}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

/* ── How it works ─────────────────────────────────────────────────────────── */

function HowItWorks() {
  return (
    <section className={styles.dark}>
      <div className={styles.wrap}>
        <div className={styles.howGrid}>
          <div className={styles.howAside}>
            <p className={styles.kickerOnDark}>How it works</p>
            <h2 className={styles.sectionTitleOnDark}>
              From the guest’s phone to the kitchen pass in under two seconds.
            </h2>
            <p className={styles.howLede}>
              One order, four screens, no phone calls. Every step writes to the
              folio and to an audit log, so nothing is lost between a guest, a
              runner and the front desk.
            </p>
            <Link href="/demo" className={styles.ghostCta}>Walk through the product</Link>
          </div>

          <ol className={styles.steps}>
            {STEPS.map((step) => (
              <li key={step.title} className={styles.step}>
                <div className={styles.stepWho}>
                  <span className={styles.stepRole}>{step.who}</span>
                  <span className={styles.stepTime}>{step.time}</span>
                </div>
                <div>
                  <h3 className={styles.stepTitle}>{step.title}</h3>
                  <p className={styles.stepBody}>{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

/* ── Revenue ──────────────────────────────────────────────────────────────── */

function Revenue() {
  return (
    <section className={styles.wrap}>
      <div className={styles.revenueHead}>
        <div>
          <p className={styles.kicker}>Revenue</p>
          <h2 className={styles.sectionTitle}>
            Every request becomes a line on the folio, not a favour at the desk.
          </h2>
        </div>
        <p className={styles.revenueLede}>
          Hotels leave money in the room because ordering is a phone call, late
          checkout is a shrug and the spa is a leaflet. Innstant turns each of
          those into a tap the guest takes on their own — priced, timed and
          charged to the room.
        </p>
      </div>

      <div className={styles.revenueGrid}>
        {REVENUE.map((card) => (
          <article key={card.title} className={styles.revenueCard}>
            {/*
              Tabular figures, like every number in the product (#5). A column
              of statistics that shifts as the digits change is the first thing
              that makes a page look homemade.
            */}
            <p className={`${styles.revenueStat} tabular`}>{card.stat}</p>
            <p className={styles.revenueStatLabel}>{card.statLabel}</p>
            <h3 className={styles.revenueTitle}>{card.title}</h3>
            <p className={styles.revenueBody}>{card.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

/* ── Quotes ───────────────────────────────────────────────────────────────── */

function Quotes() {
  return (
    <section className={styles.wrap}>
      <div className={styles.quotes}>
        {QUOTES.map((quote) => (
          <figure key={quote.name} className={styles.quote}>
            <blockquote className={styles.quoteText}>{quote.text}</blockquote>
            <figcaption className={styles.quoteWho}>
              <span
                className={styles.quoteAvatar}
                style={{ background: quote.avatarBg, color: quote.avatarInk }}
              >
                {quote.initials}
              </span>
              <span>
                <span className={styles.quoteName}>{quote.name}</span>
                <span className={styles.quoteRole}>{quote.role}</span>
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

/* ── Security ─────────────────────────────────────────────────────────────── */

function Security() {
  return (
    <section className={styles.dark} id="security">
      <div className={styles.wrap}>
        <div className={styles.sectionHead}>
          <p className={styles.kickerOnDark}>Security &amp; multi-tenancy</p>
          <h2 className={styles.sectionTitleOnDark}>
            Your guests’ data is yours. Your neighbour’s is theirs.
          </h2>
          <p className={styles.howLede}>
            Innstant runs many hotels on one platform. The isolation between
            them is enforced where a bug in a screen cannot bypass it: in the
            database.
          </p>
        </div>

        <div className={styles.securityGrid}>
          {SECURITY.map((item) => (
            <article key={item.kicker} className={styles.securityCard}>
              <div className={styles.securityHead}>
                <span className={styles.securityKicker}>{item.kicker}</span>
                <span className={styles.securityBadge} data-tone={item.badgeTone}>
                  {item.badge}
                </span>
              </div>
              <h3 className={styles.securityTitle}>{item.title}</h3>
              <p className={styles.securityBody}>{item.body}</p>
            </article>
          ))}
        </div>

        <div className={styles.securityNotes}>
          <div className={styles.securityNote}>
            <p className={styles.kickerOnDark}>What we don’t do</p>
            <h3 className={styles.securityNoteTitle}>No real guest data in demos, ever.</h3>
            <p className={styles.securityBody}>
              Every demo property is seeded from a fixture and reset on demand.
              Sales, support and engineering never touch a live guest record to
              show you something.
            </p>
          </div>
          <div className={styles.securityNote}>
            <p className={styles.kickerOnDark}>Hosting</p>
            <h3 className={styles.securityNoteTitle}>Singapore region, Indian payments.</h3>
            <p className={styles.securityBody}>
              Application and database run in Singapore for latency to Indian
              properties. Payments go through Razorpay; card data never touches
              our servers. Media is stored in object storage with signed URLs.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Contact ──────────────────────────────────────────────────────────────── */

function Contact() {
  return (
    <section className={styles.wrap} id="contact">
      <div className={styles.contactGrid}>
        <div>
          <p className={styles.kicker}>Book a demo</p>
          <h2 className={styles.sectionTitle}>
            Twenty minutes, on your phone, with your menu.
          </h2>
          <p className={styles.sectionLede}>
            Tell us the property and we set up a demo instance with your name,
            rooms and outlets before the call. You scan, you order, your team
            watches it land.
          </p>

          <dl className={styles.contactFacts}>
            <Fact term="Setup time" detail="Live in a week for a property under 100 rooms" />
            <Fact term="Hardware" detail="Printed QR stickers, one tablet per kitchen, staff phones" />
            <Fact term="Pricing" detail="Per room per month, discussed on the call" />
            <Fact term="Email" detail="hello@innstant.in" />
          </dl>
        </div>

        <DemoRequestForm />
      </div>

      <div className={styles.closing}>
        <span className={styles.closingMark} aria-hidden="true">
          <InnstantMark size={220} />
        </span>
        <div className={styles.closingCopy}>
          <h2 className={styles.closingTitle}>
            See it running on your own property in twenty minutes.
          </h2>
          <p className={styles.closingBody}>
            Or don’t wait for us — the demo property is open right now, with a
            kitchen, a runner and a front desk behind it that all actually work.
          </p>
        </div>
        <div className={styles.closingActions}>
          <Link href="/demo" className={styles.closingPrimary}>See how it works</Link>
          <a href="#contact-form" className={styles.closingSecondary}>Book a demo</a>
        </div>
      </div>
    </section>
  );
}

function Fact({ term, detail }: { term: string; detail: string }) {
  return (
    <div className={styles.fact}>
      <dt className={styles.factTerm}>{term}</dt>
      <dd className={styles.factDetail}>{detail}</dd>
    </div>
  );
}

/* ── Footer ───────────────────────────────────────────────────────────────── */

function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.wrap}>
        <div className={styles.footerGrid}>
          <div className={styles.footerBrand}>
            <InnstantLogo size={26} />
            <p className={styles.footerBlurb}>
              Guest services software for hotels that care how the app feels as
              much as how the lobby does.
            </p>
          </div>

          <nav className={styles.footerCol} aria-label="Product">
            <h2 className={styles.footerHeading}>Product</h2>
            <a href="#product">How it works</a>
            <a href="#security">Security</a>
            <Link href="/demo">See the demo room</Link>
          </nav>

          <nav className={styles.footerCol} aria-label="Company">
            <h2 className={styles.footerHeading}>Company</h2>
            <a href="#contact">Book a demo</a>
            <a href="mailto:hello@innstant.in">hello@innstant.in</a>
            <Link href="/admin">Staff sign in</Link>
          </nav>

          <div className={styles.footerCol}>
            <h2 className={styles.footerHeading}>Legal</h2>
            {/*
              Not links. There are no privacy, terms or DPA pages yet, and a
              footer link to a 404 is worse on a page whose whole security
              section is about being able to trust what it says.
            */}
            <span className={styles.footerPending}>Privacy · coming</span>
            <span className={styles.footerPending}>Terms · coming</span>
            <span className={styles.footerPending}>Data processing · coming</span>
          </div>
        </div>

        <div className={styles.footerRule}>
          <span>© 2026 Innstant</span>
          <span>Made for hotels in India · Hosted in Singapore</span>
        </div>
      </div>
    </footer>
  );
}

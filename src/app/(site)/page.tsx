import Link from 'next/link';
import { InnstantLogo, InnstantMark } from '@/components/innstant-logo';
import { NAV, SECTIONS, PILLARS, STEPS, REVENUE, THEMES, SECURITY, QUOTES } from './content';
import { DemoRequestForm } from './demo-request-form';
import { Reveal, SiteHeader } from './motion';
import { SiteIcon, type SiteIconName } from './site-icons';
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
    <SiteHeader>
      <div className={styles.navInner}>
        <Link href="#top" className={styles.navBrand} aria-label="Innstant, back to top">
          {/* Above the fold and in the first paint — not lazy. */}
          <InnstantLogo size={30} tone="light" priority />
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
          <a href="#contact" className={styles.navSignIn}>Book a demo</a>
          {/*
            The filled button in the header is the LIVE DEMO, not the contact
            form. Both are still here, and below 720px the two quiet links
            drop out and this is the only thing left — which is the intended
            reading of "what should somebody do first".
          */}
          <Link href="/demo" className={styles.navCta}>
            <SiteIcon name="play" size={15} />
            See the live demo
          </Link>
        </div>
      </div>
    </SiteHeader>
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
          A personal concierge on the phone your guest already has. Dinner,
          towels, the front desk, a later checkout — and your kitchen,
          housekeeping and reception see each one the moment it happens.
        </p>

        <div className={styles.heroActions}>
          {/*
            ─── The demo is the primary action ─────────────────────────────

            It was the other way round: "Book a 20-minute demo" filled and
            "See how it works" in the outlined secondary. That asks a stranger
            for a calendar slot before they have seen anything, and it spends
            the page's loudest button on the harder yes.

            `/demo` is the one link here that goes somewhere real — it asks
            what to call the visitor, then opens the seeded property as a
            guest. Letting somebody answer "is this any good" for themselves
            in thirty seconds is what makes the second button worth pressing,
            so the second button is what it demotes.
          */}
          <Link href="/demo" className={styles.primaryCta}>
            <SiteIcon name="play" size={16} />
            See how it works
          </Link>
          <a href="#contact" className={styles.secondaryCta}>Book a 20-minute demo</a>
        </div>

        {/* Directly under the buttons, because the first objection to a link
            that says "see it" is always what it is going to ask for first. */}
        <p className={styles.heroReassure}>
          <SiteIcon name="qr" size={15} />
          The demo opens a real hotel we invented. No signup, no card.
        </p>

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
      <Reveal className={styles.sectionHead}>
        <p className={styles.kicker}>{SECTIONS.product.kicker}</p>
        <h2 className={styles.sectionTitle}>{SECTIONS.product.title}</h2>
      </Reveal>

      <div className={styles.pillars}>
        {/* 90ms apart: enough to read as a sequence, short enough that the
            third card is not still arriving when the eye reaches it. */}
        {PILLARS.map((pillar, i) => (
          <Reveal as="article" key={pillar.kicker} className={styles.pillar} delay={i * 90}>
            <div className={styles.pillarHead}>
              <span className={styles.pillarKicker}>{pillar.kicker}</span>
              {/*
                The shape survives — a door, a tile and a ring are the brand's
                three marks and they are what tells the cards apart at a
                glance. It is a container now rather than a solid, with the
                mark for this audience inside it: a phone for the guest, a
                screen for the team, a rupee for the owner.
              */}
              <span className={styles.pillarShape} data-shape={pillar.shape} data-tone={pillar.tone}>
                <SiteIcon name={pillar.icon} size={22} />
              </span>
            </div>
            <h3 className={styles.pillarTitle}>{pillar.title}</h3>
            <p className={styles.pillarBody}>{pillar.body}</p>

            <ul className={styles.pillarChips}>
              {pillar.chips.map((chip) => (
                <li key={chip.label} className={styles.pillarChip} data-tone={pillar.tone}>
                  <SiteIcon name={chip.icon} size={15} />
                  {chip.label}
                </li>
              ))}
            </ul>

            <p className={styles.pillarFoot}>{pillar.foot}</p>
          </Reveal>
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
          <Reveal className={styles.howAside}>
            <p className={styles.kickerOnDark}>{SECTIONS.how.kicker}</p>
            <h2 className={styles.sectionTitleOnDark}>{SECTIONS.how.title}</h2>
            <p className={styles.howLede}>{SECTIONS.how.lede}</p>
            {/* Filled, like the hero's. This section is where somebody decides
                they would rather press it than keep reading, and a ghost
                outline on navy was the quietest thing on the page. */}
            <Link href="/demo" className={styles.darkCta}>
              <SiteIcon name="play" size={16} />
              Walk through it yourself
            </Link>
          </Reveal>

          <ol className={styles.steps}>
            {STEPS.map((step, i) => (
              <Reveal as="li" key={step.title} className={styles.step} delay={i * 70}>
                <div className={styles.stepWho}>
                  <span className={styles.stepIcon}>
                    <SiteIcon name={step.icon} size={20} />
                  </span>
                  <span className={styles.stepWhoText}>
                    <span className={styles.stepRole}>{step.who}</span>
                    <span className={styles.stepTime}>{step.time}</span>
                  </span>
                </div>
                <div>
                  <h3 className={styles.stepTitle}>{step.title}</h3>
                  <p className={styles.stepBody}>{step.body}</p>
                  {/*
                    What is actually on that screen at that minute, drawn
                    instead of described — the half of each paragraph that
                    used to narrate a button. Decorative: every value in it
                    is already in the sentence above or is the demo
                    property's own data.
                  */}
                  <p className={styles.stepProof} aria-hidden="true">
                    <span className={styles.stepProofLabel}>{step.proof.label}</span>
                    <span className={`${styles.stepProofValue} tabular`}>{step.proof.value}</span>
                  </p>
                </div>
              </Reveal>
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
      <Reveal className={styles.revenueHead}>
        <div>
          <p className={styles.kicker}>{SECTIONS.revenue.kicker}</p>
          <h2 className={styles.sectionTitle}>{SECTIONS.revenue.title}</h2>
        </div>
        <p className={styles.revenueLede}>{SECTIONS.revenue.lede}</p>
      </Reveal>

      <div className={styles.revenueGrid}>
        {REVENUE.map((card, i) => (
          <Reveal as="article" key={card.title} className={styles.revenueCard} delay={i * 80}>
            {/*
              Tabular figures, like every number in the product (#5). A column
              of statistics that shifts as the digits change is the first thing
              that makes a page look homemade.
            */}
            <span className={styles.revenueIcon}>
              <SiteIcon name={card.icon} size={20} />
            </span>
            <p className={`${styles.revenueStat} tabular`}>{card.stat}</p>
            <p className={styles.revenueStatLabel}>{card.statLabel}</p>
            <h3 className={styles.revenueTitle}>{card.title}</h3>
            <p className={styles.revenueBody}>{card.body}</p>
          </Reveal>
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
        {QUOTES.map((quote, i) => (
          <Reveal as="figure" key={quote.name} className={styles.quote} delay={i * 90}>
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
          </Reveal>
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
        <Reveal className={styles.sectionHead}>
          <p className={styles.kickerOnDark}>{SECTIONS.security.kicker}</p>
          <h2 className={styles.sectionTitleOnDark}>{SECTIONS.security.title}</h2>
          <p className={styles.howLede}>{SECTIONS.security.lede}</p>
        </Reveal>

        <div className={styles.securityGrid}>
          {SECURITY.map((item, i) => (
            <Reveal as="article" key={item.kicker} className={styles.securityCard} delay={(i % 3) * 80}>
              <div className={styles.securityHead}>
                <span className={styles.securityKicker}>
                  <SiteIcon name={item.icon} size={17} />
                  {item.kicker}
                </span>
                <span className={styles.securityBadge} data-tone={item.badgeTone}>
                  {item.badge}
                </span>
              </div>
              <h3 className={styles.securityTitle}>{item.title}</h3>
              <p className={styles.securityBody}>{item.body}</p>
            </Reveal>
          ))}
        </div>

        <div className={styles.securityNotes}>
          <div className={styles.securityNote}>
            <p className={styles.kickerOnDark}>What we don’t do</p>
            <h3 className={styles.securityNoteTitle}>No real guest data in demos, ever.</h3>
            <p className={styles.securityBody}>
              Every demo runs on a hotel we invented, and it is wiped and rebuilt
              on request. Nobody here opens a real guest’s record to show you
              something.
            </p>
          </div>
          <div className={styles.securityNote}>
            <p className={styles.kickerOnDark}>Hosting</p>
            <h3 className={styles.securityNoteTitle}>Close to home.</h3>
            <p className={styles.securityBody}>
              Everything runs from Singapore, which is near enough that the app
              feels instant on Indian hotel wifi — the network it actually has
              to work on. Payments go through Razorpay. Your photos and menus are
              served from somewhere close to whoever is looking at them.
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
          <p className={styles.kicker}>{SECTIONS.contact.kicker}</p>
          <h2 className={styles.sectionTitle}>{SECTIONS.contact.title}</h2>
          <p className={styles.sectionLede}>{SECTIONS.contact.lede}</p>

          <dl className={styles.contactFacts}>
            <Fact icon="setup" term="Setup time" detail="Live in a week, under 100 rooms" />
            <Fact icon="tablet" term="Hardware" detail="QR stickers, a kitchen tablet, staff phones" />
            <Fact icon="wallet" term="Pricing" detail="Per room per month, discussed on the call" />
            <Fact icon="mail" term="Email" detail="hello@innstant.in" />
          </dl>
        </div>

        <DemoRequestForm />
      </div>

      <Reveal className={styles.closing}>
        <span className={styles.closingMark} aria-hidden="true">
          <InnstantMark size={300} />
        </span>
        <div className={styles.closingCopy}>
          <h2 className={styles.closingTitle}>
            See it running on your own property in twenty minutes.
          </h2>
          <p className={styles.closingBody}>
            Or don’t wait for us. The demo property is open right now, with a
            kitchen, a runner and a front desk behind it that all work.
          </p>
        </div>
        <div className={styles.closingActions}>
          <Link href="/demo" className={styles.closingPrimary}>
            <SiteIcon name="play" size={16} />
            See how it works
          </Link>
          <a href="#contact-form" className={styles.closingSecondary}>Book a demo</a>
        </div>
      </Reveal>
    </section>
  );
}

function Fact({
  icon,
  term,
  detail,
}: {
  icon: SiteIconName;
  term: string;
  detail: string;
}) {
  return (
    <div className={styles.fact}>
      <dt className={styles.factTerm}>
        <SiteIcon name={icon} size={16} />
        {term}
      </dt>
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
            <InnstantLogo size={28} tone="light" />
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
          <span>Made for hotels in India</span>
        </div>
      </div>
    </footer>
  );
}

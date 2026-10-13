import { withTenant } from '@/db';
import { adminAccess, AdminDenied } from '../guard';
import { findProperty, can } from '@/modules/identity';
import { listOutlets } from '@/modules/catalog';
import { listVisitLinks, listOpenVisits } from '@/modules/visit';
import { AdminShell } from '../admin-shell';
import { CreateLinkForm, LinkField, LinkControls } from './link-forms';
import styles from '../admin.module.css';

/**
 * Property links — the codes that are not on a nightstand. D-079.
 *
 * A room sticker belongs to a room, and lives on the room board. These belong
 * to an outlet: a tent on a table, a code at the till, a link in a bio. One
 * screen, because the thing somebody does here is compare them — which tents
 * exist, which ones are being used, and which one has to be reprinted.
 *
 * `catalog:manage` to create or revoke, `catalog:read` to look. That split is
 * the same one the menu makes: a link decides who can order from a menu, which
 * makes it the F&B manager's, not the person who renumbers a wing.
 */
export const dynamic = 'force-dynamic';

const KIND_WORDS: Record<string, string> = {
  TABLE: 'Table',
  COUNTER: 'Counter',
  ONLINE: 'Sent link',
};

export default async function LinksAdmin() {
  const access = await adminAccess('catalog:read');
  if (!access.ok) return <AdminDenied reason={access.reason} />;
  const { session, propertyId } = access;

  // Read to look, manage to mint. The actions re-check regardless — this
  // decides what to draw, exactly as the guard's own note says.
  const mayManage = can(session, propertyId, 'catalog:manage');

  const { property, outlets, links, openVisits } = await withTenant(
    { tenantId: session.tenantId, propertyId },
    async (tx) => ({
      property: await findProperty(tx, propertyId),
      outlets: await listOutlets(tx, propertyId),
      links: await listVisitLinks(tx, { propertyId }),
      openVisits: await listOpenVisits(tx, { propertyId, limit: 20 }),
    }),
  );

  const propertyName = property?.name ?? 'This property';

  /**
   * From `APP_URL` and NOT from this request: `output: 'standalone'` binds
   * 0.0.0.0, so a URL derived from `request.url` behind Railway's proxy is an
   * internal hostname. Null when it is unset, and the client falls back to the
   * origin the admin is actually on.
   */
  const origin = process.env.APP_URL?.replace(/\/+$/, '') ?? null;

  const outletName = new Map(outlets.map((o) => [o.id, o.name]));
  const live = links.filter((l) => !l.revokedAt);
  const revoked = links.filter((l) => l.revokedAt);

  return (
    <AdminShell session={session} propertyId={propertyId} propertyName={propertyName} current="links">
      <h1 className={styles.title}>Links</h1>
      <p className={styles.lede}>
        A code that is not on a nightstand. Somebody who opens one sees this
        property&rsquo;s menu and can order from it — to a table, to the counter,
        or to an address. They are not checked into anything and nothing is
        charged to a room.
      </p>

      <section className={styles.section}>
        <header className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>
            {live.length ? `${live.length} live` : 'Nothing live yet'}
          </h2>
          <p className={styles.sectionBlurb}>
            Open one to check it before you print it — it opens a real order
            screen, exactly as a customer would see it.
          </p>
        </header>

        {live.length ? (
          <ul className={styles.dishes}>
            {live.map((link) => (
              <li key={link.id} className={styles.dish}>
                <div className={styles.dishBody}>
                  <span className={styles.dishName}>{link.label}</span>
                  <span className={styles.dishBlurb}>
                    {KIND_WORDS[link.kind] ?? link.kind}
                    {link.tableLabel ? ` · prints “${link.tableLabel}”` : ''}
                    {' · '}
                    {outletName.get(link.outletId) ?? 'an archived menu'}
                    {' · '}
                    {link.visitCount === 0
                      ? 'never opened'
                      : `opened ${link.visitCount} ${link.visitCount === 1 ? 'time' : 'times'}`}
                    {link.version > 1 ? ` · version ${link.version}` : ''}
                  </span>
                  <LinkField
                    code={link.publicCode}
                    origin={origin}
                    label={`the link for ${link.label}`}
                  />
                </div>

                {mayManage ? (
                  <div className={styles.rowEnd}>
                    <LinkControls
                      propertyId={propertyId}
                      visitLinkId={link.id}
                      label={link.label}
                      origin={origin}
                      revoked={false}
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.sectionEmpty}>
            No property links yet. Make one below and the menu is reachable
            without a room.
          </p>
        )}
      </section>

      {mayManage ? (
        <section className={styles.section}>
          <header className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>A new link</h2>
            <p className={styles.sectionBlurb}>
              The code is random and is shown once here and in the list above. It
              is never written to the activity log — anybody who has it can
              order, so it is treated like the sticker in a room.
            </p>
          </header>

          {outlets.length ? (
            <CreateLinkForm propertyId={propertyId} outlets={outlets} origin={origin} />
          ) : (
            <p className={styles.sectionEmpty}>
              There is no menu to point a link at yet. Set one up under Menu
              first.
            </p>
          )}
        </section>
      ) : null}

      <section className={styles.section}>
        <header className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Ordering right now</h2>
          <p className={styles.sectionBlurb}>
            Open sessions against a property link. A session lasts six hours or
            until it is closed, so a quiet list here does not mean a quiet
            kitchen — the kitchen display is where the orders are.
          </p>
        </header>

        {openVisits.length ? (
          <ul className={styles.dishes}>
            {openVisits.map((visit) => (
              <li key={visit.id} className={styles.dish}>
                <div className={styles.dishBody}>
                  <span className={styles.dishName}>
                    {visit.tableLabel
                      ?? visit.customerName
                      ?? (visit.fulfilment === 'DELIVERY' ? 'A delivery' : 'Somebody at the counter')}
                  </span>
                  <span className={styles.dishBlurb}>
                    {visit.fulfilment === 'DINE_IN' ? 'Dining in'
                      : visit.fulfilment === 'DELIVERY' ? 'Delivery' : 'Collecting'}
                    {/* The name only once it has been given — a visit is
                        anonymous until checkout (#9), and showing a blank where
                        a name goes reads as a missing name rather than as a
                        customer who has not ordered yet. */}
                    {visit.customerName && visit.tableLabel ? ` · ${visit.customerName}` : ''}
                    {visit.deliveryAddress ? ` · ${visit.deliveryAddress}` : ''}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.sectionEmpty}>Nobody has a link open right now.</p>
        )}
      </section>

      {revoked.length ? (
        <section className={styles.section}>
          <header className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>Revoked</h2>
            <p className={styles.sectionBlurb}>
              Kept rather than deleted, so the orders they placed still point at
              something. None of these open.
            </p>
          </header>
          <ul className={styles.dishes}>
            {revoked.map((link) => (
              <li key={link.id} className={styles.dish}>
                <div className={styles.dishBody}>
                  <span className={styles.dishName}>{link.label}</span>
                  <span className={styles.dishBlurb}>
                    {KIND_WORDS[link.kind] ?? link.kind}
                    {' · '}
                    {link.visitCount === 0
                      ? 'never opened'
                      : `opened ${link.visitCount} ${link.visitCount === 1 ? 'time' : 'times'}`}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className={styles.footnote}>
        An order from one of these posts nothing to a folio — there is no stay to
        post it to. The money is the order&rsquo;s own total, taken at the
        counter or at the door, and the kitchen display shows where the tray
        goes rather than a room number.
      </p>
    </AdminShell>
  );
}

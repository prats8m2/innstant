# Seeing it work, in the UI

Every feature built so far, with the exact clicks. Written to be followed by
someone who did not build it — a demo script, and the fastest way to check that
a change did not break something three screens away.

The automated suites cover all of this (`pnpm test:e2e`); this file is for
looking at it with your own eyes.

---

## Start it up

```bash
nvm use                       # Node 22 — pnpm 11 refuses anything older

# A local Postgres, twenty times faster than the remote one and safe to wipe.
docker start ci-pg || docker run -d --name ci-pg \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=guest_services -p 55432:5432 postgres:18

export DATABASE_URL=postgres://app_user:app_user@localhost:55432/guest_services
export DATABASE_MIGRATION_URL=postgres://postgres:postgres@localhost:55432/guest_services
export STAFF_TENANT_ID=deadbeef-0000-4000-8000-000000000001

pnpm db:bootstrap && pnpm db:migrate      # first time only
pnpm demo:reset                           # wipes and reseeds The Kesari

pnpm build && pnpm start                   # http://localhost:3000
```

`pnpm demo:reset` prints **three QR links** and the staff logins. The QR codes
are regenerated on every reset — read them from that output, never from here.

**Staff password for every account: `kesari-demo-2026`.**

| Who | Email | What they can reach |
|---|---|---|
| GM | `gm@thekesari.example` | everything below |
| F&B manager | `fnb@thekesari.example` | the whole menu, prices, hours |
| Kitchen | `kitchen@thekesari.example` | the KDS; on the menu, only the 86 switch |
| Runner | `runner@thekesari.example` | the runner queue |
| Front desk | `frontdesk@thekesari.example` | (P3 — nothing yet) |

For the guest screens, open the QR link in a **narrow window or a phone
emulator** — the guest app is mobile-only by design, 390px wide.

---

## 1 · The guest orders dinner

1. Open the **room 214** link from the seeder output. No login, no verification
   — that is CLAUDE.md #9, and it is the product's whole opening move.
2. The header shows the property's real name, the stay's real checkout time, and
   whether the kitchen is open **from its actual hours**.
3. Tap **Order to the room** → the menu. Editorial sections lead ("From the
   rooftop", "Chef Bhairav's table"). Between 22:00 and 01:00 in Udaipur a third
   appears, "After 10pm" — that window is real.
4. Tap **Laal maas with bajra roti**. Choose modifiers; the total on the **Add to
   order** button moves as you choose.
5. **Add to order** → back on the menu, a pill at the bottom shows the cart.
6. Tap the pill → the cart. Change quantities, remove a line.
7. **Send to the kitchen** → the one verification prompt: the last four digits of
   the booking phone (in the seeder output under *guests*). Get it wrong once on
   purpose — it says so and keeps the order.
8. Answer correctly → the **tracking screen**: an arrival window, a five-step
   timeline, and the order folded away underneath.

## 2 · The kitchen sees it, live

Do this in a **second window** so nothing reloads.

1. Sign in as **kitchen@thekesari.example** → `/kds`.
2. Place an order as in §1. The ticket appears **without a reload**, in well under
   a second. The guest's timeline moves at the same moment.
3. **Accept** → **Start cooking** → **Ready**. Watch the guest's timeline follow:
   *Order received → In the kitchen → Plated and covered*.
4. **Cannot make it** with a reason instead: the guest's screen replaces the
   timeline with one sentence, the kitchen's own words, and "nothing has been
   charged" — which is true, because the folio line is credited in the same
   transaction.

## 3 · The runner takes it up

1. Sign in as **runner@thekesari.example** → `/runner`.
2. A tray that the kitchen marked **Ready** is waiting, oldest first, with how
   long it has been on the pass.
3. **Take it up** → it leaves the kitchen's rail; the guest reads *On the way up*.
4. **Handed over** → the guest reads *At your door* and the live indicator
   disappears: nothing more will happen that they need.

## 4 · The menu, editable

Sign in as **fnb@thekesari.example** → `/admin/menu`.

- **Change a price.** Click a dish, edit the price, save. Reload the guest menu:
  the new price is there. Scroll the dish page: *Repriced from ₹620 to ₹680*, in
  its history.
- **Take a dish off tonight.** *Take off* on any row. The guest menu shows it as
  unavailable rather than hiding it. *Put back on* undoes it.
- **Add a dish** to any section, with modifiers and dietary flags.
- **Add or rename a section.** Try archiving one that still holds dishes — it
  refuses and names the count.
- **Close the kitchen** (top right) stops new orders immediately, without
  touching the hours.

Sign in as **kitchen@thekesari.example** and open the same page: only the *Take
off* buttons are there. No prices, no removing, no sections. That split is
deliberate — a kitchen tablet left signed in overnight is the credential most
likely to be misused.

## 5 · The kitchen's hours and rates — `/admin/outlet`

As the **GM** or **F&B manager**.

- The top line shows **exactly what a guest is reading right now**.
- **What it charges**: tax and service as percentages, delivery fee and minimum
  as rupees, and the minutes a guest is promised.
- **When it is open**: seven days, each with a time and a *past midnight* box.
  Change a closing time and reload the guest menu — the line follows.
- Try 19:00 → 02:00 **without** ticking *past midnight*: it refuses. That
  combination reads as closed all evening, and catching it here beats a kitchen
  wondering why nobody ordered.

## 6 · Collections — `/admin/menu/collections`

The guest menu's sections **are** these.

- Each heading says whether it is *showing now*, *outside its window* or
  *switched off* — computed with the same function the guest read uses.
- **Add a collection**, write the line underneath, tick a few dishes, save.
  Reload the guest menu: a new section, with your words under the heading.
- Give one a window of 22:00–01:00 and it disappears outside those hours. That
  is how "After 10pm" works, and it was showing at breakfast until it was fixed.
- **Archive** one: the collection goes, the dishes stay on the menu. A collection
  is a view, not a container.

## 7 · Option groups — `/admin/menu/options`

As the **GM** or **F&B manager** (a price difference is a price).

- Each heading carries the count of dishes affected: *Chilli · required · choose
  1 · 7 dishes*. An edit here is an edit to all seven.
- **Add a group**, then **add options** to it. `120` adds ₹120; `-50` takes ₹50
  off. One may be the default.
- Attach it to a dish from **the dish form** (`/admin/menu` → a dish → *Choices
  the guest gets*).
- Open that dish as a guest and pick the paid option: **the Add to order total
  moves by exactly that amount.** That is the whole path in one screen.
- Try a **required** group with a minimum of zero: refused. Try archiving a group
  seven dishes carry: refused, with the count, and a second button that does it
  deliberately.

## 8 · A dish with its own hours

`/admin/menu` → a dish → **When it is on**.

- Set row one to *Every day*, `07:00` to `10:30`, and save. Open the guest menu:
  outside those hours the dish reads **Not available now** and cannot be added.
  Inside them it behaves normally.
- A single day works too — *Sunday*, `12:00`–`16:00` for a Sunday biryani.
- Three rows, so a dish can be on twice a day. Leave them all blank and the dish
  is on whenever the kitchen is, which is the default.
- This is not the same as the **On the menu tonight** box below it. The schedule
  is the standing rule; that box is the switch the kitchen flips when it runs out.

The rule is enforced on the order, not just the display: a scheduled dish sitting
in a cart outside its window does not price into the total and `Send` refuses it.

## 9 · The kitchen board

`/kds` as **kitchen@thekesari.example**.

- The header shows **N waiting** — tickets nobody has accepted. It clears as they
  are accepted, and it is the alert that always works.
- A new ticket also makes a **two-note sound**. It is synthesised, so there is no
  audio file to host; browsers block audio until the page has been interacted
  with, so if you have not clicked anything yet, click once and place another
  order.
- The **age** on each ticket turns saffron in the last quarter of its promised
  time and inverts to a block when it is past it — against each ticket's own
  promise, so a 40-minute dish and a 10-minute chai are not late at the same age.
  It re-renders every 20 seconds, so a quiet board still ages.
- **86** next to any line takes that dish off the guest menu — try it, then check
  the guest menu. The order on the ticket is unaffected; it still has to be
  cooked or rejected. The button only appears while the ticket is the kitchen's
  (placed or accepted), and only for accounts with `catalog:availability`.

## 10 · Asking for things (P2)

From the room home, two rows go somewhere now.

**Amenities** — `/r/<code>/amenities`.

- Four groups: *Bring me*, *The room*, *Something is not working*, *Services*.
  Free things say **NO CHARGE**; laundry and the airport transfer carry a price
  chip, stated before anything is committed.
- Towels have a stepper (up to four); a sewing kit has an **Ask** toggle. That
  difference comes from `request_types.allows_quantity` and `max_quantity`.
- Pick two towels, add a note, and send: no prompt, and the request lands on its
  own screen with what you asked for and *Nothing to pay*.
- Pick **Laundry service** (₹450) and send: the one verification prompt appears —
  the same one dinner uses — and answering it completes the request rather than
  making you send again. The charge is on the folio (see the snippet below).
- **Actually, never mind** cancels it while it is live.

**Call for service** — `/r/<code>/service`. One tap, an optional note, and it
lands on the same screen. Free, so nothing is asked.

**The floor board** — `/housekeeping` as `housekeeping@thekesari.example`.

Open it on a narrow window BEFORE asking for anything, and leave it open.

- A request a guest raises appears **without a reload**, with the room, the floor,
  what to bring, the guest's note, and the clock. A new one also makes a sound;
  a breach makes a lower, doubled one.
- **I am going** takes it and marks it *Yours*. **Done** moves it to the quieter
  *Done, not checked* section, where a supervisor's **Checked** finishes it — and
  the countdown stops, because the clock stops with the work.
- **Put it back** hands an assigned request back to the board and clears the
  name, so nobody assumes it is covered.
- **Cannot do it** needs a reason, and the guest reads it.
- The guest's own screen follows all of this live.

Sign in as `kitchen@thekesari.example` and open `/housekeeping`: it says this
account cannot see service requests. That role holds no request permission.

**Clock in, and watch a request route itself.** This is P2's exit criterion.

1. On the board, the bar at the top says *You are not clocked in. Nothing will be
   routed to you until you are.* Tick the floors you are covering and **Clock
   in**. The bar turns and lists them; the header shows *1 on duty*.
2. As a guest, ask for towels from room 214.
3. The guest's screen reads **"Sunita Devi is on the way"** — a name, because
   there is one now — and the board's card says **Yours** and *ASSIGNED*. Nobody
   tapped anything on the staff side.
4. **Change floors** mid-shift updates the same shift. **Clock out** and ask
   again: the request stays *OPEN*, the guest reads "Someone is coming up", and
   the card waits on the board. That is deliberate — a request routed to someone
   who went home looks handled and nobody is coming.

The rules, if you want to see them refuse: a **runner** on the floor does not get
towels (wrong role), a housekeeper covering only the **third** floor does not get
a second-floor request, and with two housekeepers on duty the second request goes
to whoever is carrying less.

**A breach, already escalated.** `pnpm demo:reset` seeds **SR-4468** — a
wake-up call for room 105, promised in five minutes and now fourteen minutes
past — and runs the sweep's own function over it. So the board opens with the
breach already on it: room 105's card carries **MANAGER TOLD** beside a
countdown reading *15m over*, above room 214's *11m left*. Nothing to wait for.

**The duty manager is told.** Sign in as **gm@thekesari.example** and the bell in
the top right of `/admin` carries a **1**. Open it:

> **SR-4468 is 14 minutes late**
> Nobody has finished it. Find whoever has it, or give it to somebody who is free.

The card links to `/housekeeping`. **Mark all seen** clears the badge and leaves
the row in the list — acknowledging is not deleting, and a GM asked "what did it
say" needs to be able to answer. The bell follows the GM onto every console
screen, and the floor board has its own: level 1 of an escalation goes to the
assignee, who is holding a phone.

Sign in as **housekeeping@thekesari.example** and that bell says *Nothing waiting
for you* — SR-4468 has no assignee, so level 1 went nowhere and level 2 went to
the GM alone. An alert is addressed to a person, not to a property.

**Watching it happen live.** The sweep runs every 60 seconds in the server
process, so this is a real wait rather than a button:

```
# Make the OTHER seeded request late too.
node -e '
const {Client}=require("pg");
(async()=>{const c=new Client({connectionString:process.env.DATABASE_MIGRATION_URL});
 await c.connect();
 await c.query(`UPDATE service_requests SET sla_target_at = now() - interval '"'"'12 minutes'"'"' WHERE request_number = '"'"'SR-4471'"'"'`);
 await c.end();})();'
```

Within a minute the server log says `sla breaches escalated`, the board's card
reddens, and the GM's bell goes to **2** with no reload — `/api/notifications/stream`
carries the nudge and the bell re-reads.

The rows behind it, including what has actually been delivered:

```
node -e '
const {Client}=require("pg");
(async()=>{const c=new Client({connectionString:process.env.DATABASE_MIGRATION_URL});
 await c.connect();
 console.table((await c.query(`
   SELECT n.template, n.status, n.sent_at, n.acknowledged_at, n.payload, su.email
   FROM notifications n JOIN staff_users su ON su.id = n.recipient_staff_id`)).rows);
 await c.end();})();'
```

`PENDING` means no screen belonging to that person has read it yet — open the
console as the GM and it becomes `SENT` (D-029).

To see the rows behind it:

```
node -e '
const {Client}=require("pg");
(async()=>{const c=new Client({connectionString:process.env.DATABASE_MIGRATION_URL});
 await c.connect();
 const r=await c.query(`
   SELECT sr.request_number, sr.status, rm.number AS room, sr.total_minor,
          sr.sla_target_at, i.label_snapshot, i.quantity
   FROM service_requests sr
   JOIN stays s ON s.id = sr.stay_id
   JOIN rooms rm ON rm.id = s.room_id
   LEFT JOIN service_request_items i ON i.service_request_id = sr.id
   ORDER BY sr.created_at DESC LIMIT 10`);
 console.table(r.rows); await c.end();})();'
```

## 11 · What guests can ask for — `/admin/requests`

Sign in as **gm@thekesari.example** and open **Requests**. This is the catalog
behind both the amenities screen and the one tap: 23 types in the four groups the
guest screens use, each with its promise, where it goes, and what it costs.

**Change a promise and watch a guest read it.** Open **Extra pillow** → *Edit
this* → *Promise, in minutes* → `9` → **Save**. The row says *9 min*. Now scan
room 214 and open Amenities: the pillow card says **Usually 9 minutes**. That one
number is both the promise on the card and the deadline the SLA sweep escalates
against — shortening one shortens the other. Put it back to `12`.

**The three things it will not let you do**, each of which used to be possible
only because there was no screen at all:

- **Price the one tap.** Open **Call for service** → *Edit this*. The price field
  is disabled: *"Calling for service stays free — a price on it would ask the
  guest to verify who they are before anyone came up."* CLAUDE.md #9, at the
  control that would break it (D-030).
- **Route to a role nobody holds.** Open the *Goes to* dropdown: staffed roles
  carry their headcount (*Housekeeping — 1*), and the empty ones say *nobody
  holds this*. Pick one and save, and the row turns saffron: *goes to Concierge,
  and nobody holds it*. That is the quiet failure this screen exists to make
  visible — routing works perfectly and nobody is ever assigned. Typing a role
  that does not exist at all is refused outright.
- **Remove something still being worked.** Ask for towels as a guest, then press
  **Remove** on Extra towels: *"One request of this kind is still open. Finish it
  first, or switch the type off instead."*

**Off is not removed.** **Take off** drops a type from the guest's list and keeps
the row here so it can be put back; open requests are unaffected. **Remove**
archives it for good — and a finished request still names it correctly, because
the line snapshotted its own label (#6).

**Renaming is safe.** The form says which key it keeps. Rename *Call for service*
to *Ring for the butler* and the one-tap screen still finds it — code looks the
type up by `CALL_SERVICE`, and that never moves.

Who changed what:

```
node -e '
const {Client}=require("pg");
(async()=>{const c=new Client({connectionString:process.env.DATABASE_MIGRATION_URL});
 await c.connect();
 console.table((await c.query(`
   SELECT el.event_type, su.email, el.payload
   FROM event_log el LEFT JOIN staff_users su ON su.id = el.actor_staff_id
   WHERE el.entity_type = $1 ORDER BY el.occurred_at`, ["request_type"])).rows);
 await c.end();})();'
```

The payload carries a diff, not a snapshot — *"who took towels from twelve
minutes to five"* should not be a spot-the-difference puzzle.

## 12 · Your stay — the folio a guest can read

Scan **room 210** (`pnpm demo:reset` prints the link) and tap **Your stay**.

**When you leave is not a secret.** "CHECKING OUT / Friday, 11am / Two nights
left. Room 210, lake view." That much is on the room home already.

**The bill is.** The four digits come first: *"Your bill is the one thing on here
that is nobody else's business."* This is the one guest screen whose content is
personal, and a sticker on a nightstand is photographable from a corridor — #9
protects browsing, and a folio is not browsing (D-031).

Answer with the last four of the guest's phone (`.demo-seed.json`, or
`+919820044444` → `4444`) and the bill opens:

```
2 Sept   Room charge · Lake view          ₹12,000
2 Sept   In-room dining · KE-1179          ₹1,180
         TOTAL SO FAR                     ₹13,180
```

Indian digit grouping and tabular figures, from `formatMoney` (#5). The footnote
says *"This is what is on the room. You settle it at the desk when you leave."* —
**not** the reference's "Nothing here is charged yet", which is false the moment
a room charge posts.

**It asks once.** Go back to the room home and return: no prompt. The tier is on
the session, and answering it granted FULL (D-031). A guest who verified while
ordering dinner never sees this screen's prompt at all.

**A cancelled charge comes back off.** From room 210: **Amenities** → *Laundry
service* → send → answer the prompt → the request screen says *"₹450 is on room
210, settled at checkout"* and the folio reads ₹13,630. Now press **never mind**:

- the request screen says *"Nothing has been charged for it — ₹450 came back off
  room 210"*;
- the folio shows both rows, the credit in teal, netting back to ₹13,180.

Both rows stay, deliberately (D-027, D-032). At 7am on checkout day the guest and
the desk can both see that laundry was charged and then credited, which is
exactly the conversation a deleted row makes unwinnable.

Room **214** has the longer folio — four lines, ₹21,540 — if you want a fuller
bill for a screenshot.

## 13 · The rules that only show up when you break them

Worth seeing once, because each of these was a setting the hotel could set and
the product ignored.

- **A minimum order.** `/admin/outlet` → *Minimum order* → `500` → save. As a
  guest, put one cheap dish in the cart: the send button is disabled and the
  line above it says how much is still to go. Set it back to `0` afterwards.
- **Charges on hold.** There is no front-desk screen yet (P3), so set it by hand:
  ```
  node -e '
  const {Client}=require("pg");
  (async()=>{const c=new Client({connectionString:process.env.DATABASE_MIGRATION_URL});
   await c.connect();
   await c.query(`UPDATE guest_property_profiles SET charging_blocked = true`);
   console.log("blocked"); await c.end();})();'
  ```
  Now send an order as a guest: it refuses with *"Charges to this room are on
  hold. The front desk can take the order."* Set it back to `false`.
- **The verification attempt limit.** `access_policies.max_attempts_per_phone`
  and `lockout_minutes` are read from the policy now, not hardcoded. Set
  `max_attempts_per_phone = 1`, then answer the phone prompt wrongly once: the
  room is locked out for `lockout_minutes`, and the lockout actually persists —
  it used to be rolled back by the very error that reported it.
- **Vouching turned off.** `access_policies.allow_staff_vouch = false` makes
  `vouchForGuest()` refuse. No screen calls it yet (it needs the front desk), so
  this one is only visible in the integration tests.

---

## Where the money shows up

The guest reads it at `/r/{code}/stay` (section 12). The desk has no screen yet —
that is the rest of P3. To see the charges behind both:

```bash
node -e '
const {Client}=require("pg");
(async()=>{
 const c=new Client({connectionString:process.env.DATABASE_MIGRATION_URL});
 await c.connect();
 const r=await c.query(`
   SELECT rm.number AS room, fl.source, fl.description, fl.amount_minor
   FROM folio_lines fl
   JOIN folios f ON f.id = fl.folio_id
   JOIN stays s ON s.id = f.stay_id
   JOIN rooms rm ON rm.id = s.room_id
   ORDER BY fl.created_at DESC LIMIT 10`);
 console.table(r.rows); await c.end();
})();'
```

A rejected order shows as two lines — the charge and a negative `ADJUSTMENT`
netting to zero (D-027), and a cancelled chargeable request now does the same
(D-032). Both stay visible on purpose: at 7am on checkout day the guest and the
desk can both see what happened.

## Not built yet

Front desk and check-in, the checkout-change request flow, express checkout and
folio settlement, concierge, image upload. The ops console says so on its own
front page rather than showing dead tiles, and the guest's stay screen shows the
folio without the reference's checkout options for the same reason — a dead
control is worse than an absent one. See `docs/PROJECT-PLAN.md` for the phase
each one belongs to.

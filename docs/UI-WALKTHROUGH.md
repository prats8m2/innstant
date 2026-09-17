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

## 0 · The console's frame

Every staff screen below sits in the same frame, and it is worth thirty seconds
before the tour starts.

**The rail on the left** lists only what your account can open. Sign in as the
front desk and Menu, Staff and The kitchen are simply not there — a console full
of links that refuse is how staff learn not to trust the console. The groups are
named: *Today* is the shift, *Service* is what the hotel sells, *Setup* changes a
few times a year, *Floor screens* are the always-on tablets. On a phone the rail
lies down into a strip that scrolls sideways.

**Overview is a dashboard, not a menu.** Four numbers — rooms occupied, requests
open and how many are past their promise, tickets in the kitchen, checkouts
waiting — each a link to the screen that can act on it, and each skipped for an
account that cannot open that screen. Under them, the things with a clock on
them. A number turns saffron only when somebody has to do something.

**Colour means one thing each.** Saffron is "look at this". Teal confirms. Clay
is destructive or refused — Delete, Remove, "past its promise". Before P3.5's UI
pass a Delete button and a late ticket were the same colour.

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

## 13 · Leaving later — the guest asks, the desk answers

Scan **room 210** and open **Your stay**. Below the folio:

```
Leaving
Staying a little longer?

  Late checkout, 2pm      THREE EXTRA HOURS              ₹2,500
  Late checkout, 6pm      THE ROOM IS YOURS ALL DAY      ₹5,000

Staying another night? The front desk arranges that one — the rate
depends on the date.

  Check out now
```

"Three extra hours" is derived from **this** stay's 11am checkout, so the same
row reads "One extra hour" for a guest due out at 1pm. The night the reference
offers is deliberately missing: pricing one needs a rate plan, which is v2
booking (D-033).

Tap **2pm** — it lights up and a bar appears carrying **Request 2pm checkout ·
₹2,500**. The price is on the button because agreeing to the amount *is* the
action. Send it, and the screen says:

> **Asked for Friday, 2pm**
> ₹2,500 if the desk says yes. Nothing is charged until they do.

Check the folio above it: nothing there yet. That sentence is a promise, and it
is kept — the fee posts on approval and never on the ask.

**Now be the desk.** Sign in as **frontdesk@thekesari.example** and open
**Leaving**. Room 210 is waiting, with what they want, what they were due out at,
and what they agreed to pay. Three things you can do:

- **Approve** — the row leaves the queue for "Already answered". Back on the
  guest's phone: the header now reads **Friday, 2pm**, the card says *"₹2,500 is
  on the room"*, and the folio has a **Late checkout · 2pm** line. All three
  happened in one transaction, along with pushing out every session on the room
  so the app in it keeps working until the new time.
- **Charge instead** — type `1000` and approve. The guest is charged ₹1,000; the
  event log keeps both numbers, so "why is this ₹1,000 when the app said ₹2,500"
  is answerable. Type `0` and it is waived entirely, and the stay still moves.
- **Decline** — a reason is required, and the guest reads it verbatim:
  *"The room turns over for a 3pm arrival."* Nothing is charged and nothing moves.

Before the desk looks, the guest can press **Never mind** and the options come
back.

The whole trail:

```
node -e '
const {Client}=require("pg");
(async()=>{const c=new Client({connectionString:process.env.DATABASE_MIGRATION_URL});
 await c.connect();
 console.table((await c.query(`
   SELECT event_type, from_status, to_status, actor_kind, payload
   FROM event_log WHERE entity_type = $1 ORDER BY occurred_at`,
   ["checkout_request"])).rows);
 await c.end();})();'
```

`agreedFeeMinor` and `chargedFeeMinor` are both on the approval, and
`sessionsExtended` says how many phones in that room kept working.

## 14 · The property — `/admin/property`

Sign in as **gm@thekesari.example** and open **Property**. The hotel's own
settings, three room types, four floors, 34 rooms. This is the screen that did
not exist until P3.5: all of it was created by `provisionProperty()` and the only
way to change any of it was to edit the seeder and wipe the property.

**Rename the hotel.** *This hotel* → change the name → it changes in the bar
above, on every screen. The timezone is a list of every zone the runtime knows,
and it is not cosmetic: kitchen hours, availability windows, business-day
rollovers and every time a guest reads are rendered in it.

**The currency is read-only**, and says why: *"this hotel has already charged in
it, and nothing converts a past bill."* Every row holding an amount carries its
own currency (#5), a folio line written in INR stays INR for ever, and there is
no exchange rate anywhere in this product. On a property that has never taken an
order the field is editable — that is the only moment it is safe.

**Add a room type.** *Add a room type* → name `Courtyard`, code `cyd` → it
appears as **CYD**, normalised, with *"no rooms"* beside it. A code is what a rate
sheet will key on, so "cyd", " CYD " and "Cyd" must not become three room types
at one hotel. There is no price field, and there is nowhere to put one: a price
belongs to a rate plan for a type on a date (#11).

*Retire* on **LKV** is refused — *"14 rooms are still a Lake view"* — and the
count was already on the row before the button was pressed. *Retire* on Courtyard
works, and it stops being offered to rooms while keeping its code.

**Open a floor.** *Add a floor* → name `Garden wing`, level `4` → it appears,
empty. Each form opens anchored to its own row rather than pushing the rows below
it down the page. Levels are unique per property, so a second floor at level 4 is refused by
name rather than by a constraint error.

**Put a room on it.** *Add a room to Garden wing* → number `401`, pick a room
type → *"Room 401 is ready. Its QR link is on the Rooms screen."*

Go to **Rooms** — thirty-four rooms, one line each, under a header that names the
columns. Find 401: it already has a public code, a **Copy link** and a
**Reprint**. That is the whole point — a room created without a QR code is
invisible to the entire guest surface, and no screen would tell you, because
every screen assumes it exists. Check somebody in and scan it: it opens their
room home.

**Reprint a sticker.** *Reprint* → *Issue a new code*. The code on the row
changes, the old link resolves to nothing, and the new one opens the room. The
guest already in 401 stays signed in on their phone — sessions bind to `stay_id`,
never to the room or the code (#10) — which is why a desk can do this to an
occupied room, and the occupied room is exactly the one whose code got
photographed in the lift.

**Take it out of service.** Back on Property, *Take out* on 401. The sticker dies
with it — paste the link you copied and it resolves to nothing, which is what
stops a code in a corridor working for ever. The room leaves the desk's Rooms
screen entirely; it is still here, marked *out of service*.

**Bring it back** and it gets a **new** code. The old sticker stays dead: it has
been out of a guest's hands for however long the room was shut, and a code that
was dead on Tuesday and live on Thursday is the wrong kind of surprise.

**Three things it refuses**, each of which the schema would otherwise reject with
an error nobody can act on:

- deleting a floor that still holds rooms — *"14 rooms are still on this floor"*
  — including out-of-service ones, which still hold the floor by FK;
- taking out a room somebody is in — *"Somebody is still in room 215. Check them
  out first."*;
- reusing the number of a removed room — *"Room 215 was removed rather than
  deleted, and still holds its number. Restore it instead."*

**Signed in as the front desk**, the page reads the same and has no controls at
all — the hotel's settings are a sentence rather than a form. `room:read` and
`room:manage` are separate permissions, `property:read` and `property:update` are
another pair, and only PROPERTY_ADMIN holds the second of each. The desk keeps
**Reprint** on the Rooms screen, because `qr:regenerate` is theirs: they are who
notices a peeled sticker, and they do not renumber wings.

## 15 · Staff — `/admin/staff`

Still as **gm@thekesari.example**, open **Staff**. Two people, and until P3.5 that
number could not change: `provisionProperty()` creates one PROPERTY_ADMIN as
INVITED with no password, S5 never built the flow that gives them one, and the
demo's GM can only sign in because `demo:reset` writes their password directly.

**Invite somebody.** *Add somebody* → a name, an email, pick **Front desk** →
*Invite them*. A link appears, with a **Copy the link** button. That is the only
time it is ever shown: only its SHA-256 is stored (#10), the same rule as a
session token, so losing it means issuing another rather than recovering this one.
There is no mail provider in this product, so the manager hands the link over the
way they already talk to their staff — which is the shape a mail provider would
send anyway.

They appear in the list straight away, marked *not signed in*.

**Open the link in a different browser.** It greets them by name, shows the email
they will sign in with, and asks for a password twice. Set it and they land on
the console already signed in — not back at a login form to type it a third time.
Open the same link again: *"This link has expired."* It works once.

Every failure reads the same — unknown, expired, revoked, already used — because
somebody probing that URL should learn nothing from which, and the person holding
a real link needs the same instruction either way.

**Switch them off.** Their sessions die in the same transaction, so the screen
they are logged into stops working immediately rather than when the cookie ages
out — reload it and they land on the sign-in form, with a `?next=` pointing back
at where they were (D-045). They keep their roles and their history; they simply cannot sign in.
Switching them back on does **not** hand their old password back — it needs a
fresh link, which is the honest thing to do to somebody who was walked out of the
building.

**Three refusals**, each protecting the same thing:

- taking away the last property admin's role, or switching them off — *"This is
  the only property admin here"*. A hotel that locks itself out of its own
  console has no route back that does not involve us and a database prompt;
- switching off the account you are holding — the button is not even drawn;
- taking away somebody's only role here — an account with no role can sign in,
  sees an empty console, and gives nobody any clue why. Switch it off instead.

**The Roles list at the bottom** shows a head count per role, including *nobody*.
That is not decoration: `request_types.route_to_role_key` routes to whoever holds
a role here, so a role nobody holds is a queue nobody is watching.

**Signed in as the front desk**, this screen is not theirs at all — `staff:read`
is PROPERTY_ADMIN's.

## 16 · The front desk — `/admin/rooms`

Sign in as **frontdesk@thekesari.example** and open **Rooms**. Thirty-four rooms
in key-rack order, four of them occupied, each showing who is in, when they are
out, and what is on the folio. An empty room offers **Check someone in**; an
occupied one offers **Vouch** and **Check out**.

**Copy a room's guest link.** Every row carries its public code, **Copy link**
and **Open**. Copy gives you `https://…/r/{code}` — the URL behind that room's QR
sticker, for reprinting one or for sending a guest the link when their camera
will not focus. **Open** loads the guest's room home in a new tab, which is how
you check a sticker works before printing forty of them; it mints a guest session
for that room exactly as a scan would.

The code shown is the LIVE one: reprinting a sticker mints a new version and
revokes the old, and the row follows. Behind `qr:read` — an account without it is
not sent the code at all.

If **Copy link** shows a text field instead of saying "Copied", the browser
refused the clipboard: it needs a secure context, and plain http over a hotel LAN
is not one. The field is selected and ready for ⌘C.

**Check somebody in.** Open room **108** → *Check someone in* → a name, a phone,
2 nights, out at 11am → **Check in to 108**. The row fills in. That went through
`createStay()`, the only door a stay is born through (#4), and the event log
attributes it to Anjali Sharma rather than to SYSTEM.

Now scan room 108's sticker on a phone: it resolves to the guest you just
created. It did not resolve to anything a minute ago — a QR code with no active
stay behind it is a bare 404 that reveals nothing about occupancy.

**Check them out**, and watch the phone die. Press **Check out** on 108 and:

- the row says *empty* again, and the room is immediately reusable — D-007's
  index only counts `CHECKED_IN`;
- every session on that stay is revoked (#10), so reload the guest's page and
  they are back at the scan;
- the sticker itself is untouched and still public. Check somebody else into 108
  and the same sticker resolves to *their* stay. That is the whole reason
  sessions bind to `stay_id` and never to `room_id`.

**A returning guest keeps their history.** Check the same phone number back in
and the row says so — `guests` is matched on `(tenant_id, phone)`, so their
notes follow them across stays and across properties in the group.

**Vouch** is D-012's front-desk bypass: "yes, that is the guest in 214." They can
then charge to the room with no prompt. It grants CHARGE and not FULL (D-031), so
they still answer the question themselves to see their own bill.

What the departure recorded:

```
node -e '
const {Client}=require("pg");
(async()=>{const c=new Client({connectionString:process.env.DATABASE_MIGRATION_URL});
 await c.connect();
 console.table((await c.query(`
   SELECT el.event_type, su.email, el.payload
   FROM event_log el LEFT JOIN staff_users su ON su.id = el.actor_staff_id
   WHERE el.entity_type = $1 ORDER BY el.occurred_at DESC LIMIT 5`,
   ["stay"])).rows);
 await c.end();})();'
```

`balanceMinor` is what was still owed when they walked, and `sessionsRevoked` is
how many phones stopped working. Checking out does **not** take the money —
settlement is the card machine until the rest of P3 lands, and the balance stays
on the folio until it is.

## 17 · A guest, and what we know — `/admin/guests/[id]`

From **Rooms**, click a guest's name. Room 214 gets you Anjali Menon: her phone,
how many stays she has had here, what she has spent across all of them, her
allergies, and the bill that is on the room right now — the same one she reads on
her own phone.

**The allergies are not a note.** They print on every kitchen ticket she sends.
Tick *nut allergy*, save, then order something as her and look at `/kds` — it is
on the ticket.

**The hold is the one control here that refuses money.** Tick *Hold charges to
the room*, save, and a banner appears at the top. Now, as the guest:

- **Extra towels** still works. No prompt, nothing in the way. A hold on charging
  must never stop somebody asking for a towel (#9) — turning a billing dispute
  into a guest who cannot call for help is the wrong failure.
- **Laundry service** is refused: *"Charges to this room are on hold. The front
  desk can arrange this for you."*

That second sentence is newer than it looks. Until this session the guest read
*"You do not have permission to do that"* — `ForbiddenError` held a fixed public
message and threw away whatever the thrower had written, so five carefully worded
refusals had never been seen by anybody (D-037). And the hold itself only covered
orders, not chargeable requests, so the laundry would have gone through (D-036).

Untick it, save, and the same request goes through.

**One guest, one group.** She is one row for the whole tenant, matched on her
phone number — so if The Kesari's owners open a second hotel, her history follows
her. What you write on this screen is this property's own: a hold set in Udaipur
is not a hold in Jaipur. The footnote on the screen says so.

Who changed what:

```
node -e '
const {Client}=require("pg");
(async()=>{const c=new Client({connectionString:process.env.DATABASE_MIGRATION_URL});
 await c.connect();
 console.table((await c.query(`
   SELECT el.event_type, su.email, el.payload
   FROM event_log el LEFT JOIN staff_users su ON su.id = el.actor_staff_id
   WHERE el.entity_type = $1 ORDER BY el.occurred_at DESC LIMIT 5`,
   ["guest"])).rows);
 await c.end();})();'
```

## 18 · Settling up — taking the money at the desk

The last thing D-035 left open: *"checking out does not take the money —
settlement is still the card machine."* It still is. This records it.

Sign in as **frontdesk@thekesari.example**, open **Rooms**, click a guest with a
balance — room 210 owes ₹15,680. Under **On the room now**, open **Take a
payment**:

```
₹15,680 on the room. Take it however they are paying, then check them out.

How much  15680        How it arrived  Card        Reference  4242
```

The amount is pre-filled with what is owed, because taking all of it is the
common case. Record it, and three things are true at once:

- the desk's copy of the bill gains a **Card · 4242** line and reads **Settled
  ₹0**;
- the guest's own screen at `/r/{code}/stay` gains the same line, in teal, and
  says *"Nothing left to pay. Ask at the desk if you want a copy."*;
- the payment form is gone — a settled bill offers none.

**Then check them out.** The bill closes: `folios.status` goes `SETTLED` with a
`settled_at`. Check out a guest who has *not* paid and the stay still ends, the
room still frees, and the balance stays on the bill with the number recorded on
the departure event (D-035). Both are legitimate; only one of them is a hotel
that got paid.

**Two things it refuses.** Try to settle a bill with money on it and it says
*"There is still money on this bill. Take it first."* Take ₹20,000 against a
₹15,680 bill and it goes through — a deposit is a real thing — and the guest's
screen says **We owe you ₹4,320**, which is the honest state rather than a
refusal.

The trail:

```
node -e '
const {Client}=require("pg");
(async()=>{const c=new Client({connectionString:process.env.DATABASE_MIGRATION_URL});
 await c.connect();
 console.table((await c.query(`
   SELECT p.provider, p.method, p.status, p.amount_minor, rm.number AS room
   FROM payments p
   JOIN folios f ON f.id = p.folio_id
   JOIN stays s ON s.id = f.stay_id
   JOIN rooms rm ON rm.id = s.room_id`)).rows);
 await c.end();})();'
```

`provider` is **DESK**, not RAZORPAY — the money moved through a card machine,
and saying otherwise would make reconciliation lie the first time somebody
compared this table to a Razorpay settlement report (D-039).

## 19 · The rules that only show up when you break them

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

Express checkout through Razorpay, refunds, a digital receipt, inbound PMS
import, concierge, image upload. Settling at the desk is built (D-039); what is
missing is taking a card online, giving money back, and emailing anybody. The PMS adapter's OUTBOUND half is built (D-038) and is idle by design —
every property runs `ManualAdapter`, which has nowhere to push to. The ops console says so on its own
front page rather than showing dead tiles, and the guest's stay screen offers no
extra night for the same reason — the rate would have to be invented (D-033). See `docs/PROJECT-PLAN.md` for the phase
each one belongs to.

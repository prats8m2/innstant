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

## 8 · The rules that only show up when you break them

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

There is no folio screen yet (P3). To see the charges:

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
netting to zero (D-027). Both stay visible on purpose: at 7am on checkout day
the guest and the desk can both see what happened.

## Not built yet

Front desk, service requests, the guest folio, concierge, image upload. The ops
console says so on its own front page rather than showing dead tiles. See
`docs/PROJECT-PLAN.md` for the phase each one belongs to.

# Demo access — The Kesari

Everything needed to open, sign into and drive the demo property, in one
place. **Every value here is seeded fixture data (D-018). None of it is a real
person, a real phone number or a real password**, and nothing here grants
access to anything but the demo tenant.

Verified against **production** on 15 October 2026, by querying the live
database rather than by copying the seeder — the two had already drifted, see
"Corrections" at the end.

Regenerate all of it with `pnpm demo:reset`, which wipes and rebuilds the
tenant and prints what it made.

---

## 1. Staff console — `/admin`

<https://innstant.in/admin/login>

**Password for every account: `kesari-demo-2026`**

| Role | Email | Name | Where it lands |
|---|---|---|---|
| PROPERTY_ADMIN | `gm@thekesari.example` | Vikram Rathore | Everything. Start here. |
| FRONT_DESK | `frontdesk@thekesari.example` | Anjali Sharma | Desk, stays, checkouts |
| F_AND_B_MANAGER | `fnb@thekesari.example` | Meera Joshi | Menu, outlet, links |
| KITCHEN | `kitchen@thekesari.example` | Chef Bhairav | `/kds` — the pass |
| RUNNER | `runner@thekesari.example` | Ravi Kumar | `/runner` — deliveries |
| HOUSEKEEPING | `housekeeping@thekesari.example` | Sunita Devi | `/housekeeping` |

All six confirmed active on production. RBAC is real: sign in as KITCHEN and
the menu editor is genuinely not there, rather than hidden.

## 2. The guest app — no login at all

This is the point of the product (#9) and the most common thing to get wrong
when demonstrating it: **there is nothing to sign into.** Open a link and
order.

### Property links — never expire

| Link | Kind | What it demonstrates |
|---|---|---|
| <https://innstant.in/p/the-kesari-order> | ONLINE | Delivery or collection. **This is what the mobile app opens.** |
| <https://innstant.in/p/the-kesari-table-4> | TABLE | Dine-in. Ticket reads "Courtyard 4"; nobody types a table number. |
| <https://innstant.in/p/the-kesari-counter> | COUNTER | Takeaway. The kitchen calls a name. |

No stay sits behind these, so they do not expire and a reseed does not break
them. Staff make, reprint and revoke them at `/admin/links`.

### Room links — these DO expire

| Room | Link | Guest | **Verification digits** |
|---|---|---|---|
| 214 | <https://innstant.in/r/the-kesari-214> | Anjali Menon | `1111` |
| 105 | <https://innstant.in/r/the-kesari-105> | Thomas Beckett | `2222` |
| 210 | <https://innstant.in/r/the-kesari-210> | Iqbal Qureshi | `4444` |
| 301 | <https://innstant.in/r/the-kesari-301> | Rhea Kapoor | `3333` |

**All four stays check out on 27 October 2026.** After that the links render a
page saying the stay has ended; `pnpm demo:reset` brings them back for another
fourteen nights (`DEMO_STAY_NIGHTS`).

The digits are **the last four of that stay's phone number, so they differ per
room** — there is no single demo PIN. They are only ever asked for at the one
escalation point (D-012): the first attempt to charge something to the room.
Browsing, ordering to pay at the counter, and calling for service never prompt.

All 34 rooms are in `.demo-seed.json`, and the desk copies any of them from
`/admin/rooms`.

## 3. Customer sign-in — the mobile app

**OTP: `0000` for every phone number.**

Enter any Indian mobile number and then `0000`. There is no SMS; the code is
fixed by `OTP_DEMO_CODE` on the server.

> **This is a demo switch, and it is not subtle about what it costs.** While it
> is set, anybody who knows a phone number can sign in as that person and see
> their name, saved addresses and order history. On this seeded property that
> is invented data. It is deleted the day a real SMS provider lands — see
> `docs/DEPLOY-D081.md`.
>
> The server announces `FIXED DEMO OTP IS ACTIVE` in its log on every send, so
> it cannot be left on unnoticed. Unset `OTP_DEMO_CODE` on Railway to turn it
> off; sign-in then answers 500 by design rather than falling back to anything.

Signing in is never required. It saves an address and keeps order history, and
the app works completely without it.

## 4. Identifiers

| | |
|---|---|
| Tenant id | `deadbeef-0000-4000-8000-000000000001` |
| Property | The Kesari, Udaipur, Rajasthan |
| Outlets | In-room dining · Rooftop |
| Currency | INR, integer minor units (#5) |
| Timezone | Asia/Kolkata — every guest-facing time is property-local |

The tenant id is fixed rather than random so demo rows are identifiable in a
shared database at a glance.

## 5. A five-minute demo path

1. **<https://innstant.in/p/the-kesari-order>** — the storefront. No login, no
   prompt, straight into the menu.
2. Add a dish, open the cart, choose **Delivery**, give a name and number,
   place it. Note that nothing asked who you are until the kitchen needed to
   ring you.
3. **`/kds`** signed in as `kitchen@thekesari.example` — the order is on the
   pass already. Accept it and watch the guest's screen move without a refresh
   (Postgres `LISTEN/NOTIFY` → SSE, no polling).
4. **`/admin`** as `gm@thekesari.example` — the same order in the ops console,
   with its event log: every status change, in the transaction that made it
   (#7).
5. In the app, **Account → Sign in**, any number, `0000`. Save an address, then
   order again and watch the cart prefill. The order appears in history; an
   order placed from the TABLE link deliberately does not (D-081).

## Corrections to what was previously written down

`docs/STATUS.md` carried **"Verification digits, where a charge prompts for
them: `1111`"**. That is true only of room 214. The challenge is the last four
digits of the phone on that particular stay, so each room has its own — the
table above is from the live database. A demo that reaches for `1111` in room
105 gets a failed attempt, and three more of those lock the room out.

It also said QR codes are regenerated on every reset and must be re-read. That
stopped being true at D-070: the demo property's codes are stable
`the-kesari-<room>` and survive a reseed. Real properties still get random
codes, and always will — a sticker is a capability URL.

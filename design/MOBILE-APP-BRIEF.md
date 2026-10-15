# Prompt — the Kesari ordering app, redesigned

Paste everything between the rules into Claude. It is written to produce a
design that can be built against the API we already have, which is why it is
specific about fields rather than vibes.

What it is deliberately NOT: a request for a Swiggy clone. Two things make
that the wrong target — we sell one restaurant, not a marketplace, and we have
no food photography at all.

---

You are designing a mobile ordering app for a single restaurant. I want a
complete, high-fidelity UI I can hand to an engineer.

## The product

**The Kesari** is a heritage hotel in Udaipur, Rajasthan. The app sells food
from one property — rooftop dining, Rajasthani classics, a chef's table. A
customer opens it from a link in an Instagram bio or a WhatsApp message and
orders delivery or pickup.

This is **a restaurant's own app, not a food-delivery marketplace.** There is
no list of restaurants, no "15 places near you", no delivery-partner tracking
map, no cuisine filter across vendors. Every screen is inside one restaurant.
Designing a Swiggy or DoorDash home screen would be solving the wrong problem.

## The hard constraint: there is no food photography

**Not one dish has an image.** There is no photo library, no budget for a
shoot, and no stock photography — a stock curry on a heritage hotel's own app
reads as a lie, and the brand will not carry it.

So the design has to make a menu desirable **through typography, layout,
material and copy**. This is the central design problem. Treat it as the brief,
not as a limitation to work around: think of a letterpress menu card, a
well-set wine list, the Penguin paperback of restaurant apps.

Each dish does have, and you should use:

- `name` — "Laal maas with bajra roti"
- `description` — one or two real sentences. "Mutton slow-cooked in Mathania
  chillies. Hot, and meant to be. Served with millet roti."
- `price` — ₹1,150
- `spiceLevel` — 1–5 (present on 14 of 17 dishes)
- `dietaryFlags` — VEGETARIAN, VEGAN, CONTAINS_NUTS (present on 10 of 17)
- `prepTimeMinutes` — present on all
- `isAvailable`, `canQuickAdd`

Do design an **optional image slot**: define what a dish card looks like when
a photo exists, since the field is there for later. But every screen must be
complete and attractive with zero images, because that is what ships.

## Brand and tokens — use these exactly

Dark, warm, Rajasthani. Lime plaster and saffron, not a generic dark theme.
Use these as CSS custom properties with these exact names.

```
--paper-deep: #0A1220   full-bleed backdrop behind a hero
--paper:      #101E33   the app's ground
--card:       #1B2B45   a card, a tile, a sheet (raised = lighter)
--raised:     #22354F   a step above a card
--line:       #243755
--line-soft:  #223353
--line-faint: #4A5A73   borders ONLY — never a text colour

--accent:      #E9A227  saffron
--accent-hover:#F2B84B  LIGHTER on hover, not darker
--accent-tint: #22354F
--accent-ink:  #101E33  text on saffron is the GROUND, never white

--ink:           #E3E5DB  lime plaster, not white
--ink-secondary: #C3C7BC
--ink-dim:       rgba(227,229,219,0.62)
--ink-faint:     rgba(227,229,219,0.45)

--positive:  #7FA9A2
--attention: #E9A227
--critical:  #E4867A   terracotta, not pure red
```

**Type** — all three are Google Fonts, load them:

- `Marcellus` — headings, dish names, the property name
- `Mukta` — body, labels, buttons
- `DM Mono` — every price, order number and quantity, with
  `font-variant-numeric: tabular-nums`

Sizes: 11 / 13 / 15 / 17 / 22 / 28 / 34.

**Shape — this one matters.** Radii are deliberately sharp: **2px, 3px, 4px**.
The only round things are pills (17px, 22px) and avatars. Do not use 8px
everywhere; that is the stock component-library look this brand exists to not
be.

**Spacing**: 4 / 8 / 12 / 16 / 24 / 32 / 48.

**Motion**: 180–320ms only. Honour `prefers-reduced-motion` by collapsing
everything to 1ms.

**Money**: Indian digit grouping, always — ₹1,150 and ₹1,207.50. Never ₹1150,
never ₹1.15k. Tabular figures so a column does not wobble.

**Icons**: Lucide only. No emoji as UI.

## Viewport

390 × 844. Mobile only — no desktop breakpoint, no tablet. Put primary actions
in the bottom 40% of the screen: this is used one-handed, standing up.
Every tappable thing is at least 48×48.

## Screens

### 1. Home — the one that matters most

Today the app opens straight onto a flat menu list, which looks like a PDF.
Replace it with a storefront that makes somebody want to order. It must work
for a first-time visitor who has never signed in.

Content available to you: the property name, the outlet name ("In-room
dining", "Rooftop"), `openLine` ("Kitchen open until 1am"), `prepTimeMinutes`
(30), `minimumOrder`, and 7 menu sections — Rooftop · Chef Bhairav · Chef's
specials · Rajasthani classics · Small plates · Sweets · Drinks.

Design: a hero that establishes the place, open/closed state and prep time
somewhere honest, a way into each section, and a few dishes surfaced on the
home itself so the first screen sells food rather than navigation. If somebody
has ordered before, a reorder affordance. If there is a live order, it belongs
at the top.

Do not invent: ratings, review counts, distance, delivery fees, discount
codes, loyalty points, or "4.2★ (2.3k)". None of that exists in the data and
inventing it makes the design unbuildable.

### 2. Menu
Sections with their blurbs, dish rows, an add control. A horizontal section
rail that tracks scroll position. Some dishes can be added in one tap
(`canQuickAdd`); others must open because they have a required choice — show
that difference.

### 3. Dish detail
Name, full description, price, spice level, dietary marks, prep time, modifier
groups (required and optional), quantity, add to cart.

### 4. Cart
Lines with quantity steppers, subtotal, tax, total. A choice between **pickup**
and **delivery**. Name and phone — the kitchen calls when it is ready. For
delivery, an address: either picked from saved addresses or typed free-text
(an Indian address is a landmark and a floor as often as a street — one line,
nothing parses it). Minimum-order state. A clear "the kitchen is closed" state.

### 5. Order tracking
Statuses: PLACED → ACCEPTED → PREPARING → READY → OUT_FOR_DELIVERY →
DELIVERED. Order number (KE-1188), total, items, and what happens next.

### 6. Order history
A list: order number, the order at a glance ("2× Laal maas · Masala chai"),
total, date, status. Live orders distinguished from past ones. An empty state
for somebody who has never ordered.

### 7. Account
Name, phone, whether the phone is verified. Entry points to saved addresses
and order history. Sign out. An empty/signed-out state that is inviting rather
than a wall.

### 8. Saved addresses
List with labels the customer chose ("Home", "Work", "Mum's"), one marked
default, add/edit/delete.

### 9. Sign-in
Phone number, then a six-digit code. An optional name field. Two steps, one
screen.

## The rule that shapes the whole app

**Browsing is never gated behind signing in.** Someone can open the app, read
the whole menu, fill a cart and place an order having never made an account.
Signing in is an upsell — it saves your address and keeps your history — and
it is offered at the cart, never imposed before the menu.

So: no login wall, no "sign in to continue", no modal on launch. The account
is a door in the corner, not a turnstile at the entrance.

## Voice

Copy is part of the design. The existing voice is specific and unapologetic,
and it does not pad:

- "Seven places we vouch for"
- "He is at your door."
- "Hot, and meant to be."
- "You pay at the counter. Nothing is charged now."
- "So the kitchen can call"

Write in that register. Never "Oops! Something went wrong" — say what happened
and what to do. Never apologise. Never vague.

## Deliverable

**One self-contained HTML artifact.** All screens laid out as 390×844 frames
side by side on a labelled canvas, so I can see the whole app at once.

- Real content throughout — the actual dish names, descriptions and prices
  above. No lorem ipsum, no "Item 1".
- The tokens as CSS custom properties with the exact names given, in `:root`,
  so I can map them to the codebase one for one.
- Inline CSS, no external files except the Google Fonts link.
- Show the states that matter, not only the happy one: empty cart, signed-out
  account, no order history, kitchen closed, a dish that is sold out.
- Annotate anything non-obvious — what a gesture does, what animates.

Start with the home screen and get it right before moving on; it is the screen
the whole brief exists for.

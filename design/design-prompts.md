# Claude Design prompts — guest-facing mobile web app

Four prompts, run in order. Don't paste them all at once. Prompt 1 establishes
the design system and gets three screens right; the rest inherit it.

---

## PROMPT 1 — Design system + three core screens

> You are the design lead on a guest-services web app for a single hotel. I want
> a distinctive visual identity, not a template. Work in two passes: plan the
> token system first, critique it against the brief, then build.
>
> **The property.** The Kesari, a 34-room boutique hotel in the old city of
> Udaipur. Converted haveli, stone courtyards, indigo-and-lime-plaster interiors,
> jharokha windows, a rooftop restaurant that overlooks Lake Pichola. Not a
> chain. Guests are mostly 30–55, half international, staying 2–4 nights, paying
> ₹14,000–28,000 a night. They expect the app to feel as considered as the
> property does.
>
> **The user and the moment.** A guest is lying on the bed in room 214 at 9:40pm.
> They scanned the QR on the nightstand with their phone camera. They are tired,
> one-handed, possibly a little drunk, on hotel wifi. They want dinner in their
> room in under three taps. They will never install an app and will never see
> this on a desktop.
>
> **Build these three screens as one continuous mobile web prototype**, with
> working navigation between them:
>
> 1. **Room home** — the post-scan landing. Establishes where they are, what they
>    can do, and that this is The Kesari and not a generic hotel portal. Entry
>    points to dining, amenities, staff, their stay, and the city.
> 2. **In-room dining menu** — browsable, with a sticky category rail, editorial
>    collections, and dish cards.
> 3. **Dish detail → cart** — the detail view for one dish with modifier
>    selection, and the cart state.
>
> **Real content, no lorem ipsum.** Use these dishes, exactly, with these prices:
> Laal maas with bajra roti ₹1,150 · Ker sangri ₹620 · Gatte ki sabzi ₹580 ·
> Mohan maas ₹1,280 · Dal baati churma ₹740 · Mawa kachori ₹380 ·
> Udaipur-style pyaaz kachori ₹260 · Masala chai ₹180 ·
> Kesar lassi ₹320 · Rooftop grilled river sole ₹1,420.
> Collections: "From the rooftop" · "After 10pm" · "Chef Bhairav's table".
> Guest is Anjali Menon, room 214, checking out Thursday 11am.
> Currency is INR with the ₹ symbol and Indian digit grouping (₹1,150 not ₹1150).
>
> **Motion is the premium signal.** Specify and implement:
> - A page-load sequence on room home — staggered, orchestrated, one moment
>   rather than five scattered fades.
> - Shared-element transition from dish card to dish detail: the image expands
>   into place, it does not cross-fade.
> - The cart is a persistent bottom pill that *morphs* when an item is added —
>   scale, count tick, subtle haptic-feeling spring. It never slides in from
>   nowhere.
> - Sticky category rail that tracks scroll position with a smooth active-pill
>   translation, and scrolls the section into view on tap.
> - Sheets use spring physics with a drag-to-dismiss handle, not a linear
>   slide-up.
> - Skeletons are shaped like the real content and never a gray rectangle.
> - Every transition 180–320ms, ease-out. Respect `prefers-reduced-motion`.
>
> **Image handling.** You cannot source real photographs, so design the image
> slots as first-class: fixed aspect ratios (16:9 hero, 4:3 dish card, 1:1
> thumbnail), a gradient scrim system for text over image, and an intentional
> CSS placeholder treatment that reads as a deliberate design choice — not an
> empty gray box. Document the exact ratios and the scrim in the token system so
> the real photography can drop straight in.
>
> **Constraints.**
> - 390×844 viewport. Design mobile-only. No desktop breakpoint.
> - Primary actions live in the bottom 40% of the screen. Assume one thumb.
> - No login screen, no signup, no onboarding carousel. The guest arrives already
>   in context.
> - Copy is sentence case, active voice, specific. A button says what happens.
> - Visible keyboard focus states. Real touch targets, 44px minimum.
>
> **Do not give me any of these.** They are what every AI design lands on:
> - Cream background (#F4F1EA-ish) with a serif display and a terracotta accent.
> - Near-black with a single acid-green or vermilion accent.
> - A hamburger menu, or a five-icon generic bottom tab bar.
> - Default shadcn styling, default Inter, default 8px radius everywhere.
> - Emoji used as icons.
> - Numbered markers (01 / 02 / 03) on content that isn't a sequence.
> - A hero with a big number, a small label, and a gradient.
>
> **Before you build**, give me the token plan: 5 named hex values, the display /
> body / utility typefaces and why those three specifically, a one-sentence
> layout concept, and the single signature element this app will be remembered
> by. Tell me which part of your first plan you revised because it read as a
> default, and what you replaced it with. Then build.

---

## PROMPT 2 — Live order tracking

> Continuing The Kesari guest app, same tokens and motion system exactly.
>
> Design the **live order status screen** the guest sees after placing an order.
> States: placed → accepted by the kitchen → preparing → ready → on its way →
> delivered. Order #KE-1184, three items, ₹2,470 posted to room 214, placed
> 9:47pm, promised by 10:20pm.
>
> The hard part is that this screen is stared at. It needs ambient life while
> nothing is happening — the progress treatment should feel alive between state
> changes, not a static bar waiting for a poll. When a state does change, it
> should be an event: the transition is animated, the previous state stays
> legible as history.
>
> Include: the runner's name and photo slot once assigned, a "message the
> kitchen" affordance, the ETA as a range not a false-precision countdown, and
> the order summary collapsed by default. No confetti.

---

## PROMPT 3 — Amenities, service call, and stay

> Continuing The Kesari guest app, same tokens and motion system.
>
> Three screens:
>
> 1. **Amenities** — a request catalog. Free items (extra towels, pillow, iron,
>    slippers, sewing kit) and chargeable ones (laundry ₹450/kg, minibar
>    restock, airport transfer ₹1,800). Quantity steppers on some, single-tap on
>    others. Each shows the ETA promise: "usually 12 minutes". Mixed free and
>    paid in one list is the design problem — make the charge unmistakable
>    without making the free items feel lesser.
>
> 2. **Call for service** — a single deliberate action, not a form. One tap sends
>    someone up. Optional note. Then it becomes a live state: "Ravi is on his
>    way · 4 min". This screen has almost no content, which makes it the hardest
>    one to make feel premium rather than empty.
>
> 3. **Your stay** — checkout Thursday 11am. Request late checkout (2pm, ₹2,500;
>    6pm, ₹5,000), extend by a night, or check out now. Below that, the running
>    room folio: 4 line items, ₹8,940 total. The folio must be readable at a
>    glance and boring in the right way — this is money, it should feel exact.
>    Tabular figures.

---

## PROMPT 4 — Concierge and itinerary

> Continuing The Kesari guest app, same tokens and motion system.
>
> **Nearby** — a curated concierge screen. Not a Google Places dump; each place
> carries a one-line note in the hotel's own voice, which is the whole point.
>
> Places: City Palace (400m, 6 min walk) · Bagore Ki Haveli evening dance show
> (7pm, 550m) · Jagdish Temple (300m) · Ambrai for lakeside dinner (partner,
> 10% off) · Sajjangarh Monsoon Palace at sunset (9km, 25 min drive) ·
> Bada Bazaar for block-print textiles (1.2km) · Baba Lassi (600m, cash only).
>
> Two modes on one screen: browse by category, and a day-plan builder where the
> guest drags places into an ordered itinerary for tomorrow. The transition
> between browsing and planning should be a real spatial change, not a tab swap.
>
> Distance and travel time are the primary metadata, not ratings. Ratings are
> what a review site shows; travel time is what a guest 400m from the City
> Palace actually needs.

---

## Working notes

**Run them in order and don't skip prompt 1's planning step.** The token plan is
what makes prompts 2–4 consistent. If Claude Design jumps straight to code, stop
it and ask for the plan.

**Expect to reject the first direction once.** That is normal and it is cheaper
than rejecting it after you've built it in Next.js. Say specifically what feels
generic rather than "make it more premium" — the second phrasing gets you the
same defaults with more shadows.

**Swap the property.** The Kesari is invented to give the design something real
to be *about*. If you have a real pilot hotel, replace the property paragraph
with its actual materials, palette, location and price point. Specificity is the
whole mechanism; a generic "luxury hotel" brief gets you a generic luxury result.

**Motion is where this will be won or lost.** Static screenshots of a hotel app
all look roughly alike. The shared-element transition and the morphing cart pill
are what will make a hotel GM say yes in the demo. Push hard on those two in
review.

**What to carry into the build.** From the output you want three things, not the
code: the token file (colors, type scale, radii, motion durations), the image
ratio + scrim spec, and the component inventory. Those become your Tailwind
config and your shadcn overrides. Treat the generated markup as a reference
rendering, not a starting codebase.

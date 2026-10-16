# Making it feel like an app

A plan for taking the Kesari ordering app from "a well-built text app" to
something that reads like Swiggy or Zomato.

---

## The thing that has to be said first

**You cannot get a Swiggy-like app without food photography.** This is not a
styling problem that a redesign can solve.

Open Swiggy and measure the screen: 60–70% of it is photographs. The dish card
is a photo with a price under it. The home is a carousel of photos. The
category rail is photos in circles. Strip the images out and what is left is a
list of names and prices — which is exactly what we have now, and it is why
the current app reads as basic.

Round 1 was deliberately typography-led *because* there were no images. That
was the right answer to "no photography". It is the wrong answer to "make it
look like Swiggy", and the two cannot both be satisfied.

So: **images are phase 0, and nothing after it lands properly without them.**
We deferred them last session. They are now the critical path.

What that actually needs (specced already, see `docs/STATUS.md` §Next):

- Cloudflare R2 + the upload pipeline, `sharp` resizing, blurhash generation
- The `image_key` migration (store the key, not the URL — #6 means a past
  receipt breaks the day the domain changes)
- An admin upload UI to replace today's "paste a CDN URL" field
- **17 dishes photographed.** Half a day with a phone and daylight. No
  infrastructure substitutes for this, and no stock photo will do: a stock
  curry on a heritage hotel's own app reads as a lie.

Everything below assumes photos exist. Where a phase can be done without
them, it says so.

## The second thing: we are not a marketplace

Swiggy's *home screen* is a list of restaurants, with cuisine filters,
delivery estimates and ratings across vendors. We have one restaurant. Copying
that home would be copying the part of Swiggy that does not apply.

**What to copy is Swiggy's restaurant DETAIL page** — the screen you reach
after tapping a restaurant. That screen is: a photo header, the restaurant's
name and timings, a search field scoped to this menu, veg/non-veg and other
filter chips, a sticky category rail, and a long list of photo dish cards with
inline steppers and a floating cart bar.

That is the right target, and it is almost exactly the app we want.

---

## Phase 0 — Images

**Blocks everything. One session, plus your half-day of photography.**

Covered above. Done when a dish card can render a photo with a blurhash
placeholder while it loads.

## Phase 1 — The app shell

**Can be done without photos. One session.**

This is what makes something feel like an app rather than a website, and it is
independent of imagery:

| | Today | Target |
|---|---|---|
| Navigation | one stack, headers | **bottom tab bar** — Home · Search · Orders · Account |
| Cart | a bar on some screens | persistent, above the tabs, on every tab |
| Loading | spinners | **skeleton shimmer** in the shape of the content |
| Refresh | none | pull-to-refresh on every list |
| Dish options | a full screen push | **bottom sheet**, dragged up over the menu |
| Touch feedback | none | haptics on add, remove, place order |
| Transitions | default push | spring physics, shared element into dish detail |

New dependencies, all over the ~50KB bar and so needing your yes:
`expo-image`, `react-native-reanimated`, `react-native-gesture-handler`,
`@gorhom/bottom-sheet`, `expo-haptics`. These are the standard set; every app
that feels like Swiggy uses approximately this list.

The tab bar is the single biggest perceived change. Today every screen is a
push onto a stack with a back arrow, which is the shape of a website.

## Phase 2 — The image-led screens

**Needs phase 0. One to two sessions.**

- **Home** — photo hero, category circles, "Order again" rail from real
  history, a horizontally scrolling featured rail, then the menu beginning
  inline. Live-order card pinned at the top.
- **Menu** — photo dish cards, sticky section rail that tracks scroll, inline
  steppers, veg/non-veg marks in the Indian convention (the green and red
  squares, which are a legal convention here and not decoration).
- **Dish** — full-bleed photo header, collapsing title, modifiers in a bottom
  sheet, quantity and total pinned at the bottom.

## Phase 3 — Discovery

**Mostly doable without photos. One session.**

- **Search.** There is no search endpoint today. With 10 dishes this is almost
  free — but build the endpoint anyway, because a menu is 60+ dishes at a real
  property and client-side filtering stops working.
- **Filter chips** — veg / non-veg / spice level / price. All three exist in
  the data today (`dietaryFlags` on 7 of 10, `spiceLevel` on 7 of 10).
- **"Most ordered" badges** — derived by counting `order_items` over a window.
  Honest, no new schema, and it is the one Swiggy-style badge we can earn
  rather than invent.

## Phase 4 — Motion and polish

**One session.**

Optimistic cart updates, shared-element transition into dish detail, empty and
error states drawn rather than defaulted, offline handling, and the 180–320ms
motion band applied throughout.

---

## What needs a decision from you

**1. Ratings and reviews.** Swiggy's visual language leans heavily on
`4.2 ★ (2.3k)`. We have no ratings table and no reviews. Two problems: it is a
schema addition plus a moderation surface, and on a single hotel restaurant a
self-published rating with no independent source is not credible — it reads as
decoration, and a guest who notices will trust the rest of the app less. **My
recommendation: do not build this.** If social proof is wanted, "most ordered
this week" is true and derivable.

**2. Offers and coupons.** This is a real feature with real weight: a money
path, so it needs idempotency (#8), snapshotting onto the order (#6), an admin
surface, and rules about stacking. It also **cannot be called `promotions`** —
that name is reserved for the booking module (CLAUDE.md #12,
`docs/EXTENSION-POINTS.md`). Worth doing, but it is its own project, not part
of a UI pass.

**3. Live delivery tracking on a map.** Swiggy shows a rider moving. We have no
rider GPS and no driver app. The honest version is the status timeline we
already have.

**4. The brand.** Swiggy and Zomato look like Swiggy and Zomato — bright,
dense, orange/red, rounded, photo-saturated. The Kesari is a heritage hotel:
dark indigo, saffron, sharp 3px radii, Marcellus. Going full Swiggy means
dropping the brand that `design/` exists to protect.

My recommendation is **Swiggy's structure, the Kesari's skin**: the tab bar,
the photo cards, the bottom sheets, the search and filters — rendered in the
existing palette and type. If you want the literal Swiggy look instead, say
so, because it changes `theme.css`, `mobile/lib/theme.ts` and the whole design
direction, and that is a bigger decision than a redesign.

## Order of work

```
Phase 0  images                    BLOCKS 2 and 4     1 session + photography
Phase 1  app shell, tabs, sheets   independent        1 session
Phase 2  image-led screens         needs 0            1–2 sessions
Phase 3  search and filters        independent        1 session
Phase 4  motion and polish         needs 1            1 session
```

Phases 0 and 1 can run in either order. If the photography will take a while
to organise, do phase 1 first — the tab bar and bottom sheets change the feel
more than any single screen, and they need nothing from you but a yes on the
dependencies.

# Making it feel like an app

A plan for taking the Kesari ordering app from "a well-built text app" to
something that reads like Swiggy or Zomato.

## Where this stands

Phases 1 to 4 are **done and committed**. Phase 0 is half done: the screens
that needed photographs have them, but they are **licensed Unsplash stand-ins
seeded for the demo**, not the restaurant's own food, and the infrastructure
under them was deferred rather than built.

| Phase | State |
|---|---|
| 0 · images | **PART DONE.** Stand-in photography seeded (`0c47914`) and a blurhash placeholder on every card. R2, the upload pipeline and the `image_key` migration are NOT built. |
| 1 · app shell | **DONE** — `4940194`, `cac2753`. |
| 2 · image-led screens | **DONE** — `6760cf6`. As good as the pictures, which are borrowed. |
| 3 · search and filters | **DONE** — `5013e56`. |
| 4 · motion and polish | **DONE** — `8358a3b`. |

What is still outstanding is at the bottom of this file, under
[What is left](#what-is-left). The short version: the photography is still
borrowed, and the three features argued about below — ratings, offers and a
rider map — were each decided against or deferred for reasons that have not
changed.

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

What happened instead is the cheapest thing that unblocked phases 2 and 4:
licensed Unsplash photographs seeded onto the ten demo dishes, so the card,
the hero and the sheet could be built and judged against real pictures. That
was the right call for the build and it is the wrong thing to ship — a stock
curry on a heritage hotel's own app reads as a lie, which is the argument
below, unchanged. The stand-ins are a scaffold, and taking them down is the
one piece of this plan that no amount of code finishes.

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

## Phase 0 — Images — PART DONE

**Blocks everything. One session, plus your half-day of photography.**

Covered above. Done when a dish card can render a photo with a blurhash
placeholder while it loads — which it does, on borrowed pictures. The four
bullets above remain unbuilt apart from the rendering: there is no R2 bucket,
no upload UI, no `image_key` column, and the admin field is still "paste a CDN
URL".

## Phase 1 — The app shell — DONE

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

## Phase 2 — The image-led screens — DONE

**Needs phase 0. One to two sessions.**

- **Home** — photo hero, category circles, "Order again" rail from real
  history, a horizontally scrolling featured rail, then the menu beginning
  inline. Live-order card pinned at the top.
- **Menu** — photo dish cards, sticky section rail that tracks scroll, inline
  steppers, veg/non-veg marks in the Indian convention (the green and red
  squares, which are a legal convention here and not decoration).
- **Dish** — full-bleed photo header, collapsing title, modifiers in a bottom
  sheet, quantity and total pinned at the bottom.

## Phase 3 — Discovery — DONE

**Mostly doable without photos. One session.**

- **Search.** There is no search endpoint today. With 10 dishes this is almost
  free — but build the endpoint anyway, because a menu is 60+ dishes at a real
  property and client-side filtering stops working.
- **Filter chips** — veg / non-veg / spice level / price. All three exist in
  the data today (`dietaryFlags` on 7 of 10, `spiceLevel` on 7 of 10).
- **"Most ordered" badges** — derived by counting `order_items` over a window.
  Honest, no new schema, and it is the one Swiggy-style badge we can earn
  rather than invent.

## Phase 4 — Motion and polish — DONE

**One session.**

Optimistic cart updates, shared-element transition into dish detail, empty and
error states drawn rather than defaulted, offline handling, and the 180–320ms
motion band applied throughout.

Four of the five shipped. **The shared-element transition did not**, and the
reason is structural rather than a thing left undone: Reanimated 4 removed
`sharedTransitionTag`, and the dish opens in a bottom sheet that is a child of
the menu screen rather than a second screen, so there is no pair to share
between. `mobile/components/spring-in.tsx` carries the full argument and the
two versions that were rejected. What shipped instead is the sheet's
photograph starting at the row's 112pt and springing to its own 84pt.

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

That is what happened: 1, 2, 3 and 4 all shipped, and phase 0 is still the
one with your half-day in it.

---

## What is left

### 1. Real photography — the only blocking item

Every screen built in phases 2 and 4 is drawn around a photograph, and every
photograph in the app today is a **licensed Unsplash stand-in seeded onto the
demo property**. They are good enough to design against and they are not the
restaurant's food. Nothing in the UI changes when they are replaced; the
pictures simply stop being a lie.

Still unbuilt underneath them, and unchanged from phase 0 above: the R2 bucket
and upload pipeline, `sharp` resizing, blurhash generation at upload time, the
`image_key` migration, and an admin upload UI. The app reads whatever URL the
admin field holds, which is why the stand-ins work at all.

**This needs a migration**, so it is not a thing the redesign could have done:
the redesign was deliberately migration-free and stayed that way.

### 2. Ratings — decided against, and the decision stands

The argument is above and nothing about shipping phases 1–4 changed it: a
self-published rating on a single hotel restaurant has no independent source,
so it reads as decoration and costs trust in everything beside it. The honest
substitute is built — the "most ordered" badge from phase 3 counts real
`order_items` over a window.

### 3. Offers and coupons — deferred, and it is its own project

A money path: idempotency (#8), snapshotting onto the order (#6), an admin
surface, stacking rules, and a name that cannot be `promotions` (#12). None of
that belongs in a UI pass, and it needs schema. Unstarted by design.

### 4. A rider map — not possible, not deferred

There is no rider GPS and no driver app to produce it. The status timeline the
orders screen already draws is the honest version, and it is the version that
ships until those exist.

### 5. What a laptop could not settle

Two things in phases 1–4 are wired, typechecked and in the Android bundle, and
have never actually run:

  · **The pull gesture.** `react-native-web`'s `RefreshControl` is an inert
    `View`, so every pull-to-refresh handler is unexercised.
  · **Haptics.** `expo-haptics` no-ops on web by design.

Both need a device, and neither is a reason to hold the rest.

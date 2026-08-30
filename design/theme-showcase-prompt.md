# Claude Design prompt — multi-theme home page showcase

One home page. Six hotel identities. Identical markup, different tokens.

---

## THE PROMPT

> Build a **theme showcase** for a hotel guest-services web app. One home page
> screen, rendered under six completely different visual identities, with a
> switcher that swaps between them live.
>
> This is a sales artifact. I show it to a hotel GM and they see their own
> property's character in it within five seconds.
>
> ---
>
> ### The hard rule
>
> **The DOM is identical across all six themes.** Same elements, same class
> names, same order, same hierarchy. Nothing is added, removed or reordered per
> theme. Everything that differs is a CSS custom property.
>
> Prove it: when I switch themes, no element may change position on the page
> except as a consequence of a token value (a larger radius, a different font's
> metrics). If you find yourself writing `.theme-beach .card { ... }` with new
> layout rules, you have broken the brief — put that value in a token instead.
>
> One bounded exception: a `--hero-style` token with exactly three permitted
> values — `cinematic` (full-bleed image, text over scrim), `editorial` (image
> beside type, asymmetric), `compact` (no hero image, type and status only).
> Three variants total across six themes. Not one per theme.
>
> ---
>
> ### The screen
>
> The post-QR-scan room home. A guest has just scanned the code on their
> nightstand. The screen must establish where they are, that this is *their*
> hotel and not a generic portal, and give them five destinations: dining,
> amenities, call for service, their stay, and the city nearby.
>
> Structure, fixed across all themes:
> - Property identity + greeting ("Good evening, Anjali · Room 214")
> - Hero region (per `--hero-style`)
> - A live-status strip — one active thing, e.g. "Order KE-1184 · on its way · 6 min"
> - Five primary destinations
> - One editorial rail — a horizontally scrolling set of three cards
> - Checkout reminder — "Checking out Thursday, 11am · Request late checkout"
> - Persistent bottom bar
>
> Mobile only, 390×844. One-handed use. Primary actions in the bottom 40%.
>
> ---
>
> ### The six properties
>
> Design each theme *for its property*, not as a palette exercise. The materials,
> the guest, and the price point should be legible in the type and colour.
>
> **1 · The Kesari** — Udaipur. 34-key converted haveli, stone courtyards, indigo
> and lime plaster, jharokha windows, rooftop over Lake Pichola. ₹22,000/night.
> Guests: 35–55, half international, 3 nights, here for the city.
>
> **2 · Aramaya** — South Goa. 60-key beach resort, laterite and casuarina,
> open-air everything, sand tracked into the lobby by design. ₹18,000/night.
> Guests: couples and families, 5 nights, barefoot the entire time.
>
> **3 · Node** — Bengaluru, Outer Ring Road. 180-key business hotel, glass and
> grey, breakfast at 6:30am, laundry back by 8pm. ₹7,000/night. Guests:
> consultants and engineers, 2 nights, in the room only to sleep and eat.
>
> **4 · Hôtel Verre** — Colaba, Mumbai. 22-key art hotel above a gallery,
> concrete and brass, a rotating collection on every floor. ₹32,000/night.
> Guests: 30–45, design-literate, they chose this over the Taj on purpose.
>
> **5 · Deodar House** — Kasauli, Himachal. 18-key wellness lodge in pine
> forest, deodar timber, no television, silence as an amenity. ₹22,000/night.
> Guests: 40–60, a week, here to not be reached.
>
> **6 · Stack** — Delhi Aerocity. 240-key modern budget hotel, pod-efficient
> rooms, self check-in, 24h counter service. ₹3,200/night. Guests: transit,
> one night, 4am departures.
>
> ---
>
> ### Token contract
>
> Every theme must be expressible as this exact object, and nothing outside it
> may vary. Output the six filled objects as JSON at the end — I am storing them
> in a database column and rendering them as CSS custom properties at runtime.
>
> ```json
> {
>   "themeKey": "heritage",
>   "color": {
>     "bg": "#______", "surface": "#______", "surfaceRaised": "#______",
>     "ink": "#______", "inkMuted": "#______", "line": "#______",
>     "accent": "#______", "accentInk": "#______",
>     "positive": "#______", "warning": "#______", "critical": "#______"
>   },
>   "type": {
>     "display": "Font Name", "body": "Font Name", "numeric": "Font Name",
>     "displayWeight": 400, "displayTracking": "-0.02em", "scaleRatio": 1.25
>   },
>   "shape": {
>     "radiusSm": "4px", "radiusMd": "12px", "radiusLg": "20px",
>     "radiusPill": "999px", "borderWidth": "1px"
>   },
>   "image": {
>     "heroRatio": "16/9", "cardRatio": "4/3",
>     "scrim": "linear-gradient(...)", "placeholderStyle": "..."
>   },
>   "motion": { "duration": "220ms", "easing": "cubic-bezier(...)", "spring": 0.4 },
>   "texture": { "type": "none|grain|pattern", "opacity": 0.04, "css": "..." },
>   "heroStyle": "cinematic|editorial|compact"
> }
> ```
>
> ---
>
> ### What must NOT vary between themes
>
> These are product decisions, not brand decisions. If a hotel wants them
> changed, the answer is no.
>
> - Touch target minimums (44px) and the position of primary actions.
> - Money typography: tabular figures, ₹ symbol, Indian digit grouping
>   (₹1,150 · ₹22,000). Money reads identically everywhere because it must be
>   scannable and exact.
> - The semantic meaning of `positive` / `warning` / `critical`. The hues may
>   shift to sit inside the palette; the meaning may not.
> - Information hierarchy and reading order.
> - Focus-visible states, and `prefers-reduced-motion` handling.
>
> ---
>
> ### The switcher
>
> A control at the top of the page — six labelled options, each showing the
> property name and its accent. Switching crossfades tokens over ~300ms so the
> transformation is visible as a transformation. That transition *is* the demo:
> the GM should watch the app become their hotel.
>
> ---
>
> ### Do not give me
>
> - Six variations on the same palette logic — six dark themes with different
>   accents, or six light themes with different accents. At least two should be
>   light-dominant, at least two dark-dominant, and the type pairings should not
>   share a single face across all six.
> - Cream (#F4F1EA-ish) + serif + terracotta. That combination is the current
>   default and it will read as generic to anyone who has seen an AI mockup.
> - Near-black + single acid accent as more than one of the six.
> - Default Inter everywhere with only the colours changed.
> - Emoji as icons. Hamburger menus. Numbered markers on non-sequences.
> - Theme names like "Modern", "Classic", "Bold". Name them after the properties.
>
> ---
>
> ### Before you build
>
> Give me a one-line thesis per theme: the material or idea it is built from, its
> palette in five hexes, and its type pairing. Then tell me which two themes came
> out closest to each other and how you pulled them apart. Then build.

---

## Follow-up prompt — adding a theme later

> Add a seventh theme to the showcase, same token contract, same DOM, same rules.
>
> **[Property name]** — [city]. [N]-key [type], [materials and character].
> ₹[X]/night. Guests: [who, how long, why they're there].
>
> It must not be the nearest neighbour of any existing theme. Tell me which
> existing theme it is closest to and what you changed to separate them.

---

## Working notes

**Take the JSON, not the code.** The six token objects go straight into
`properties.branding`. Your Next.js app reads that column, emits the values as
CSS custom properties on `<html>`, and every hotel gets its identity from one
row. That is the entire theming system — no per-tenant builds, no forked
components.

**Extend the branding column to match.** The schema currently types `branding` as
a loose object with logo, hero, accent and fonts. Once you settle the contract
above, tighten the TypeScript type to it and validate on write, so a hotel can't
save a palette that breaks contrast.

**Contrast is the thing that will break.** A GM will ask for their exact brand
gold on white. Run every theme's `ink` on `bg` and `accentInk` on `accent`
through a WCAG AA check in the admin panel at save time, and refuse the save
with a suggested nearest-passing value. Cheaper than discovering it in a
customer's lobby.

**Sell three, not six.** Six is right for building the system and wrong for the
pitch. In the room, show the GM the two closest to their property and one
deliberate outlier. Six choices makes a buyer defer; three makes them pick.

**The switcher animation is the demo.** Static screenshots of six themes look
like a colour palette. Watching the app transform into their hotel in 300ms is
what closes it. If the crossfade feels cheap in the output, push on that
specifically before anything else.

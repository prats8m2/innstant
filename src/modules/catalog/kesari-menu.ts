/**
 * The Kesari's menu. Dishes and prices are taken verbatim from
 * design/design-prompts.md — the same content the design was drawn against, so
 * a rebuilt screen can be compared to the reference without a translation step.
 *
 * Prices are integer minor units (#5): ₹1,150 is 115_000 paise.
 */
export interface MenuItemSeed {
  name: string;
  description: string;
  priceMinor: number;
  category: string;
  dietaryFlags?: string[];
  spiceLevel?: number;
  prepTimeMinutes?: number;
  collections?: string[];
  /** DEMO ONLY — see `DEMO_PHOTOGRAPHY` below. Never a real property's. */
  imageUrl?: string;
}

/**
 * Stand-in photography, for the demo and for nothing else.
 *
 * ─── Why these are here and not in the product ────────────────────────────
 *
 * The app is being rebuilt to a Swiggy-like shape, and that shape is mostly
 * photographs — strip them out and a dish card is a name and a price, which
 * is the version that read as basic. The Kesari's own dishes have not been
 * shot yet, so these stand in until they are.
 *
 * They live in the SEEDER, deliberately. Nothing in `src/modules` or
 * `src/app` reaches for them, no fallback renders them, and no code path
 * outside `pnpm demo:reset` can put one on a plate. A real property that
 * uploads nothing shows no photograph — which is the honest outcome, and the
 * one the upload pipeline will replace these with.
 *
 * ─── They are stand-ins, and the app should not pretend otherwise ─────────
 *
 * None of these is a photograph of the dish it is attached to. They are
 * north-Indian curries and sweets of roughly the right colour and framing.
 * On a hotel's own menu that would be a lie, which is why this is scoped to
 * the invented tenant (D-018) and why the real fix is seventeen photographs
 * and half a day of daylight.
 *
 * ─── Licence ──────────────────────────────────────────────────────────────
 *
 * Unsplash, under the Unsplash Licence: free to use commercially, no
 * permission needed, no attribution required. Each URL below was fetched and
 * confirmed to answer 200 with `image/jpeg` before being written down —
 * a guessed photo id is a broken image on every card.
 *
 * The query string is ours: `w=800` because the widest a dish card gets is a
 * phone, `q=70` because this is a demo on hotel wifi, and `fit=crop` so the
 * aspect ratio is decided by us rather than by whatever the photographer
 * framed.
 */
const UNSPLASH = (id: string) => `https://images.unsplash.com/photo-${id}?w=800&q=70&fm=jpg&fit=crop`;

export const KESARI_CATEGORIES = [
  'Chef’s specials', 'Rajasthani classics', 'From the rooftop',
  'Small plates', 'Sweets', 'Drinks',
] as const;

export const KESARI_COLLECTIONS = [
  { name: 'From the rooftop', editorialNote: 'Cooked over coals upstairs, with the lake below.' },
  { name: 'After 10pm',       editorialNote: 'The kitchen is quieter. These still come out fast.',
    availableFrom: '22:00', availableUntil: '01:00' },
  { name: 'Chef Bhairav’s table', editorialNote: 'What Bhairav cooks when the family visits.' },
] as const;

export const KESARI_MENU: readonly MenuItemSeed[] = [
  { name: 'Laal maas with bajra roti', priceMinor: 115_000, category: 'Chef’s specials',
    description: 'Mutton slow-cooked in Mathania chillies. Hot, and meant to be. Served with millet roti.',
    spiceLevel: 4, prepTimeMinutes: 35,
    collections: ['Chef Bhairav’s table', 'From the rooftop'],
    dietaryFlags: ['NON_VEGETARIAN'], imageUrl: UNSPLASH('1565557623262-b51c2513a641') },
  { name: 'Mohan maas', priceMinor: 128_000, category: 'Chef’s specials',
    description: 'Chicken in a milk and cardamom gravy, finished with almonds. A royal-kitchen dish, mild.',
    spiceLevel: 1, prepTimeMinutes: 35,
    collections: ['Chef Bhairav’s table', 'From the rooftop'],
    dietaryFlags: ['NON_VEGETARIAN', 'CONTAINS_NUTS'],
    imageUrl: UNSPLASH('1772730064970-a7b2735c93b9') },
  { name: 'Rooftop grilled river sole', priceMinor: 142_000, category: 'From the rooftop',
    description: 'Whole sole from the lake, charred over coals with lime and ajwain.',
    spiceLevel: 2, prepTimeMinutes: 30, collections: ['From the rooftop'],
    dietaryFlags: ['NON_VEGETARIAN'], imageUrl: UNSPLASH('1596797038530-2c107229654b') },
  { name: 'Ker sangri', priceMinor: 62_000, category: 'Rajasthani classics',
    description: 'Desert berries and beans, tempered with red chilli. Nothing green grows here; this is what does.',
    dietaryFlags: ['VEGETARIAN', 'VEGAN'], spiceLevel: 3, prepTimeMinutes: 20,
    collections: ['Chef Bhairav’s table'],
    imageUrl: UNSPLASH('1603894584373-5ac82b2ae398') },
  { name: 'Gatte ki sabzi', priceMinor: 58_000, category: 'Rajasthani classics',
    description: 'Gram-flour dumplings in a yoghurt curry, cooked the way it is at home.',
    dietaryFlags: ['VEGETARIAN'], spiceLevel: 2, prepTimeMinutes: 25,
    collections: ['Chef Bhairav’s table'],
    imageUrl: UNSPLASH('1631292784640-2b24be784d5d') },
  { name: 'Dal baati churma', priceMinor: 74_000, category: 'Rajasthani classics',
    description: 'Baked wheat baatis, five-lentil dal, and sweet churma. Order it if you order nothing else.',
    dietaryFlags: ['VEGETARIAN'], spiceLevel: 2, prepTimeMinutes: 40,
    collections: ['Chef Bhairav’s table'],
    imageUrl: UNSPLASH('1585937421612-70a008356fbe') },
  { name: 'Udaipur-style pyaaz kachori', priceMinor: 26_000, category: 'Small plates',
    description: 'Onion and fennel, fried to order. Two pieces.',
    dietaryFlags: ['VEGETARIAN'], spiceLevel: 2, prepTimeMinutes: 15,
    collections: ['After 10pm'],
    imageUrl: UNSPLASH('1728910156510-77488f19b152') },
  { name: 'Mawa kachori', priceMinor: 38_000, category: 'Sweets',
    description: 'Sweet kachori filled with mawa and nuts, soaked in saffron syrup.',
    dietaryFlags: ['VEGETARIAN'], prepTimeMinutes: 15, collections: ['After 10pm'],
    imageUrl: UNSPLASH('1767114915989-c6ab3c8fc42e') },
  { name: 'Masala chai', priceMinor: 18_000, category: 'Drinks',
    description: 'Boiled with ginger, cardamom and a little too much sugar unless you say otherwise.',
    dietaryFlags: ['VEGETARIAN'], prepTimeMinutes: 10, collections: ['After 10pm'],
    imageUrl: UNSPLASH('1762922425226-8cfe6987e7b0') },
  { name: 'Kesar lassi', priceMinor: 32_000, category: 'Drinks',
    description: 'Thick, saffron, served cold in a clay tumbler.',
    dietaryFlags: ['VEGETARIAN'], prepTimeMinutes: 10, collections: ['After 10pm'],
    imageUrl: UNSPLASH('1772730065344-4cf131b39951') },
];

/**
 * Modifier groups, and which dishes carry them.
 *
 * Reusable across items on purpose — that reuse is the whole reason
 * `menu_item_modifier_groups` exists rather than a column on the item. "Chilli"
 * is one row shared by seven dishes; renaming it renames it everywhere.
 *
 * Taken from the design reference, with one deliberate omission. The export
 * offers sweets a "Make it two" option priced at the dish's own price — which
 * our schema cannot express (`price_delta_minor` is a fixed amount per option,
 * not a formula) and which the quantity stepper on the same screen already
 * does. Two ways to order two of something is worse than one.
 */
export interface ModifierOptionSeed {
  name: string;
  /** Signed minor units. A modifier may reduce the price. */
  priceDeltaMinor?: number;
  isDefault?: boolean;
}

export interface ModifierGroupSeed {
  name: string;
  isRequired: boolean;
  minSelections: number;
  maxSelections: number;
  options: readonly ModifierOptionSeed[];
  /** Menu item names this group attaches to. */
  items: readonly string[];
}

const SAVOURY = [
  'Laal maas with bajra roti', 'Mohan maas', 'Rooftop grilled river sole',
  'Ker sangri', 'Gatte ki sabzi', 'Dal baati churma',
  'Udaipur-style pyaaz kachori',
] as const;

/** The design's SWEET set: served warm or cold, and never asked about chilli. */
const SWEET = ['Mawa kachori', 'Masala chai', 'Kesar lassi'] as const;

export const KESARI_MODIFIER_GROUPS: readonly ModifierGroupSeed[] = [
  {
    name: 'Chilli',
    isRequired: true, minSelections: 1, maxSelections: 1,
    options: [
      { name: 'Gentle' },
      // The default is what the kitchen actually cooks. "The heat is the dish"
      // — a guest who wants it milder says so; nobody is asked to opt in to
      // the chef's own recipe.
      { name: 'As the chef makes it', isDefault: true },
      { name: 'Extra fiery' },
    ],
    items: SAVOURY,
  },
  {
    name: 'Serve it',
    isRequired: true, minSelections: 1, maxSelections: 1,
    options: [{ name: 'Warm', isDefault: true }, { name: 'Cold' }],
    items: SWEET,
  },
  {
    name: 'Add',
    isRequired: false, minSelections: 0, maxSelections: 1,
    options: [
      { name: 'Nothing', isDefault: true },
      { name: 'Extra ghee', priceDeltaMinor: 6_000 },
      { name: 'Steamed rice', priceDeltaMinor: 14_000 },
    ],
    items: ['Mohan maas', 'Rooftop grilled river sole', 'Ker sangri',
            'Gatte ki sabzi', 'Dal baati churma', 'Udaipur-style pyaaz kachori'],
  },
  {
    // Its own group, not an option on the one above: bajra roti belongs with
    // laal maas and nowhere else on this menu.
    name: 'Add a roti',
    isRequired: false, minSelections: 0, maxSelections: 1,
    options: [
      { name: 'Nothing', isDefault: true },
      { name: 'Extra bajra roti', priceDeltaMinor: 9_000 },
    ],
    items: ['Laal maas with bajra roti'],
  },
];

/** 34-key haveli, 4 floors, 3 room types. */
export const KESARI_ROOM_TYPES = [
  { code: 'HAV', name: 'Haveli room', maxOccupancy: 2 },
  { code: 'LKV', name: 'Lake view', maxOccupancy: 2 },
  { code: 'JHR', name: 'Jharokha suite', maxOccupancy: 3 },
] as const;

export const KESARI_FLOORS = [
  { level: 0, name: 'Courtyard' },
  { level: 1, name: 'First' },
  { level: 2, name: 'Second' },
  { level: 3, name: 'Rooftop' },
] as const;

/**
 * 34 rooms across 4 floors. The distribution is uneven on purpose so that
 * **room 214 exists** — the design reference, the seeded stay and every
 * screenshot in design/ are built around Anjali Menon in 214, and a demo whose
 * headline room is missing is not a demo.
 *
 *   Courtyard  001-006   6   Haveli room
 *   First      101-112  12   Haveli room
 *   Second     201-214  14   Lake view      <- 214
 *   Rooftop    301-302   2   Jharokha suite
 */
export const KESARI_ROOMS = [
  ...Array.from({ length: 6 },  (_, i) => ({ number: `00${i + 1}`,                       floorLevel: 0, roomTypeCode: 'HAV' })),
  ...Array.from({ length: 12 }, (_, i) => ({ number: `1${(i + 1).toString().padStart(2, '0')}`, floorLevel: 1, roomTypeCode: 'HAV' })),
  ...Array.from({ length: 14 }, (_, i) => ({ number: `2${(i + 1).toString().padStart(2, '0')}`, floorLevel: 2, roomTypeCode: 'LKV' })),
  ...Array.from({ length: 2 },  (_, i) => ({ number: `3${(i + 1).toString().padStart(2, '0')}`, floorLevel: 3, roomTypeCode: 'JHR' })),
];

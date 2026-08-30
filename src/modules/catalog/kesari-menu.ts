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
}

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
    spiceLevel: 4, prepTimeMinutes: 35, collections: ['Chef’s table'] },
  { name: 'Mohan maas', priceMinor: 128_000, category: 'Chef’s specials',
    description: 'Chicken in a milk and cardamom gravy, finished with almonds. A royal-kitchen dish, mild.',
    spiceLevel: 1, prepTimeMinutes: 35, collections: ['Chef’s table'] },
  { name: 'Rooftop grilled river sole', priceMinor: 142_000, category: 'From the rooftop',
    description: 'Whole sole from the lake, charred over coals with lime and ajwain.',
    spiceLevel: 2, prepTimeMinutes: 30, collections: ['From the rooftop'] },
  { name: 'Ker sangri', priceMinor: 62_000, category: 'Rajasthani classics',
    description: 'Desert berries and beans, tempered with red chilli. Nothing green grows here; this is what does.',
    dietaryFlags: ['VEGETARIAN', 'VEGAN'], spiceLevel: 3, prepTimeMinutes: 20 },
  { name: 'Gatte ki sabzi', priceMinor: 58_000, category: 'Rajasthani classics',
    description: 'Gram-flour dumplings in a yoghurt curry, cooked the way it is at home.',
    dietaryFlags: ['VEGETARIAN'], spiceLevel: 2, prepTimeMinutes: 25 },
  { name: 'Dal baati churma', priceMinor: 74_000, category: 'Rajasthani classics',
    description: 'Baked wheat baatis, five-lentil dal, and sweet churma. Order it if you order nothing else.',
    dietaryFlags: ['VEGETARIAN'], spiceLevel: 2, prepTimeMinutes: 40 },
  { name: 'Udaipur-style pyaaz kachori', priceMinor: 26_000, category: 'Small plates',
    description: 'Onion and fennel, fried to order. Two pieces.',
    dietaryFlags: ['VEGETARIAN'], spiceLevel: 2, prepTimeMinutes: 15,
    collections: ['After 10pm'] },
  { name: 'Mawa kachori', priceMinor: 38_000, category: 'Sweets',
    description: 'Sweet kachori filled with mawa and nuts, soaked in saffron syrup.',
    dietaryFlags: ['VEGETARIAN'], prepTimeMinutes: 15, collections: ['After 10pm'] },
  { name: 'Masala chai', priceMinor: 18_000, category: 'Drinks',
    description: 'Boiled with ginger, cardamom and a little too much sugar unless you say otherwise.',
    dietaryFlags: ['VEGETARIAN'], prepTimeMinutes: 10, collections: ['After 10pm'] },
  { name: 'Kesar lassi', priceMinor: 32_000, category: 'Drinks',
    description: 'Thick, saffron, served cold in a clay tumbler.',
    dietaryFlags: ['VEGETARIAN'], prepTimeMinutes: 10, collections: ['From the rooftop'] },
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

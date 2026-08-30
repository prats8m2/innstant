import { pgTable, uuid, text, integer, boolean, index } from 'drizzle-orm/pg-core';
import {
  pk, ts, createdAt, updatedAt, tenantId, propertyId, archivedAt, currency,
} from './_shared';
import { stays } from './stay';

/**
 * P4. The GM's own one-line note is the product here — a curated list beats a
 * Google Maps embed precisely because a human who knows the city wrote it.
 * Distance and travel time are the primary sort, refreshed nightly.
 */
export const pois = pgTable('pois', {
  id: pk(),
  tenantId: tenantId(),
  propertyId: propertyId(),

  name: text('name').notNull(),
  category: text('category').notNull(),
  description: text('description'),
  /** The GM's voice. P4's exit criterion is that adding one takes under a
   *  minute, so this is a single line, not a rich-text field. */
  editorialNote: text('editorial_note'),

  addressLine: text('address_line'),
  latitude: text('latitude'),
  longitude: text('longitude'),
  phone: text('phone'),
  websiteUrl: text('website_url'),
  imageUrl: text('image_url'),

  /** Refreshed by the nightly job, not computed per request. */
  walkMinutes: integer('walk_minutes'),
  driveMinutes: integer('drive_minutes'),
  distanceMetres: integer('distance_metres'),
  distanceRefreshedAt: ts('distance_refreshed_at'),

  isPartner: boolean('is_partner').notNull().default(false),
  partnerOffer: text('partner_offer'),

  priceLevel: integer('price_level'),
  currency: currency(),

  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),

  archivedAt: archivedAt(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('pois_property_category_idx').on(t.propertyId, t.category, t.walkMinutes)]);

export const itineraries = pgTable('itineraries', {
  id: pk(),
  tenantId: tenantId(),
  propertyId: propertyId(),
  stayId: uuid('stay_id').notNull().references(() => stays.id),

  name: text('name').notNull(),
  forDate: ts('for_date'),

  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('itineraries_stay_idx').on(t.stayId)]);

export const itineraryStops = pgTable('itinerary_stops', {
  id: pk(),
  tenantId: tenantId(),
  itineraryId: uuid('itinerary_id').notNull().references(() => itineraries.id, { onDelete: 'cascade' }),
  /** Null for a custom stop the guest typed themselves. */
  poiId: uuid('poi_id').references(() => pois.id, { onDelete: 'set null' }),

  customLabel: text('custom_label'),
  note: text('note'),
  plannedAt: ts('planned_at'),
  sortOrder: integer('sort_order').notNull().default(0),

  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('itinerary_stops_itinerary_idx').on(t.itineraryId, t.sortOrder)]);

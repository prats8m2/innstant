CREATE TYPE "public"."access_tier" AS ENUM('BROWSE', 'REQUEST', 'CHARGE', 'FULL');--> statement-breakpoint
CREATE TYPE "public"."checkout_request_status" AS ENUM('REQUESTED', 'APPROVED', 'COMPLETED', 'DECLINED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."escalation_trigger" AS ENUM('FIRST_CHARGE', 'FIRST_REQUEST', 'ANY_ACTION', 'NEVER');--> statement-breakpoint
CREATE TYPE "public"."folio_source" AS ENUM('ORDER', 'SERVICE_REQUEST', 'CHECKOUT_FEE', 'ADJUSTMENT', 'PAYMENT', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('DRAFT', 'PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CLOSED', 'REJECTED', 'CANCELLED', 'DISPUTED');--> statement-breakpoint
CREATE TYPE "public"."outlet_kind" AS ENUM('IN_ROOM_DINING', 'RESTAURANT', 'BAR', 'CAFE', 'SPA', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."service_request_status" AS ENUM('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED', 'REJECTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."shift_status" AS ENUM('SCHEDULED', 'ON_DUTY', 'ON_BREAK', 'OFF_DUTY');--> statement-breakpoint
CREATE TYPE "public"."stay_source" AS ENUM('WALK_IN', 'FRONT_DESK', 'PMS_IMPORT');--> statement-breakpoint
CREATE TYPE "public"."stay_status" AS ENUM('RESERVED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW');--> statement-breakpoint
CREATE TYPE "public"."verification_method" AS ENUM('PHONE_LAST4', 'OTP_SMS', 'STAFF_VOUCH');--> statement-breakpoint
CREATE TABLE "access_escalations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"guest_session_id" uuid NOT NULL,
	"from_tier" "access_tier" NOT NULL,
	"to_tier" "access_tier" NOT NULL,
	"triggered_by" text NOT NULL,
	"method" "verification_method",
	"outcome" text DEFAULT 'STARTED' NOT NULL,
	"completed_at" timestamp with time zone,
	"abandoned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "access_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"base_tier" "access_tier" DEFAULT 'REQUEST' NOT NULL,
	"escalation_trigger" "escalation_trigger" DEFAULT 'FIRST_CHARGE' NOT NULL,
	"allow_phone_last4" boolean DEFAULT true NOT NULL,
	"allow_otp_sms" boolean DEFAULT true NOT NULL,
	"allow_staff_vouch" boolean DEFAULT true NOT NULL,
	"max_attempts_per_room" integer DEFAULT 5 NOT NULL,
	"max_attempts_per_phone" integer DEFAULT 5 NOT NULL,
	"lockout_minutes" integer DEFAULT 30 NOT NULL,
	"session_grace_minutes" integer DEFAULT 120 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guest_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"stay_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"is_anonymous" boolean DEFAULT true NOT NULL,
	"access_tier" "access_tier" DEFAULT 'REQUEST' NOT NULL,
	"scanned_qr_code_id" uuid,
	"ip_address" text,
	"user_agent" text,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_vouches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"stay_id" uuid NOT NULL,
	"guest_session_id" uuid,
	"staff_user_id" uuid NOT NULL,
	"granted_tier" "access_tier" NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"stay_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"method" "verification_method" NOT NULL,
	"challenge_hash" text,
	"phone_last4" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"succeeded_at" timestamp with time zone,
	"locked_until" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "folio_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"folio_id" uuid NOT NULL,
	"source" "folio_source" NOT NULL,
	"source_ref_id" uuid,
	"description" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"pms_posted_at" timestamp with time zone,
	"pms_ref" text,
	"posted_by_staff_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "folios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"stay_id" uuid NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"charges_minor" integer DEFAULT 0 NOT NULL,
	"payments_minor" integer DEFAULT 0 NOT NULL,
	"balance_minor" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"folio_id" uuid NOT NULL,
	"provider" text DEFAULT 'RAZORPAY' NOT NULL,
	"provider_payment_id" text,
	"provider_order_id" text,
	"amount_minor" integer NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"method" text,
	"provider_payload" jsonb,
	"captured_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collection_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"collection_id" uuid NOT NULL,
	"menu_item_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"name" text NOT NULL,
	"editorial_note" text,
	"image_url" text,
	"available_from" text,
	"available_until" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menu_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menu_item_availability_windows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"menu_item_id" uuid NOT NULL,
	"day_of_week" integer,
	"starts_at" text NOT NULL,
	"ends_at" text NOT NULL,
	"crosses_midnight" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menu_item_modifier_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"menu_item_id" uuid NOT NULL,
	"modifier_group_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menu_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price_minor" integer NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"image_url" text,
	"blurhash" text,
	"dietary_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"spice_level" integer,
	"prep_time_minutes" integer,
	"is_available" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "modifier_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"name" text NOT NULL,
	"min_selections" integer DEFAULT 0 NOT NULL,
	"max_selections" integer DEFAULT 1 NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "modifier_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"name" text NOT NULL,
	"price_delta_minor" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"is_available" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outlet_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"day_of_week" integer NOT NULL,
	"opens_at" text NOT NULL,
	"closes_at" text NOT NULL,
	"crosses_midnight" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outlets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"kind" "outlet_kind" DEFAULT 'IN_ROOM_DINING' NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"image_url" text,
	"tax_rate_bps" integer DEFAULT 0 NOT NULL,
	"service_charge_bps" integer DEFAULT 0 NOT NULL,
	"delivery_fee_minor" integer DEFAULT 0 NOT NULL,
	"minimum_order_minor" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"is_accepting_orders" boolean DEFAULT true NOT NULL,
	"prep_time_minutes" integer DEFAULT 30 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "itineraries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"stay_id" uuid NOT NULL,
	"name" text NOT NULL,
	"for_date" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "itinerary_stops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"itinerary_id" uuid NOT NULL,
	"poi_id" uuid,
	"custom_label" text,
	"note" text,
	"planned_at" timestamp with time zone,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pois" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"description" text,
	"editorial_note" text,
	"address_line" text,
	"latitude" text,
	"longitude" text,
	"phone" text,
	"website_url" text,
	"image_url" text,
	"walk_minutes" integer,
	"drive_minutes" integer,
	"distance_metres" integer,
	"distance_refreshed_at" timestamp with time zone,
	"is_partner" boolean DEFAULT false NOT NULL,
	"partner_offer" text,
	"price_level" integer,
	"currency" text DEFAULT 'INR' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"actor_staff_id" uuid,
	"actor_guest_session_id" uuid,
	"actor_kind" text DEFAULT 'SYSTEM' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"status" text DEFAULT 'IN_PROGRESS' NOT NULL,
	"response_body" jsonb,
	"response_status" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"target" text NOT NULL,
	"operation" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shift_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"floor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"staff_user_id" uuid NOT NULL,
	"status" "shift_status" DEFAULT 'SCHEDULED' NOT NULL,
	"scheduled_start_at" timestamp with time zone NOT NULL,
	"scheduled_end_at" timestamp with time zone NOT NULL,
	"clocked_in_at" timestamp with time zone,
	"clocked_out_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "floors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"name" text NOT NULL,
	"level" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"branding" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"address_line" text,
	"city" text,
	"country_code" text,
	"latitude" text,
	"longitude" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"permission" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "room_qr_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"public_code" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "room_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"description" text,
	"max_occupancy" integer DEFAULT 2 NOT NULL,
	"total_rooms" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"floor_id" uuid NOT NULL,
	"room_type_id" uuid NOT NULL,
	"number" text NOT NULL,
	"status" text DEFAULT 'AVAILABLE' NOT NULL,
	"notes" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_property_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"staff_user_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"staff_user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"full_name" text NOT NULL,
	"phone" text,
	"avatar_url" text,
	"status" text DEFAULT 'INVITED' NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checkout_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"stay_id" uuid NOT NULL,
	"status" "checkout_request_status" DEFAULT 'REQUESTED' NOT NULL,
	"requested_checkout_at" timestamp with time zone NOT NULL,
	"fee_minor" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"overridden_fee_minor" integer,
	"decided_by_staff_id" uuid,
	"decided_at" timestamp with time zone,
	"decline_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guest_property_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"guest_id" uuid NOT NULL,
	"is_vip" boolean DEFAULT false NOT NULL,
	"charging_blocked" boolean DEFAULT false NOT NULL,
	"staff_notes" text,
	"dietary_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"lifetime_value_minor" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"phone" text,
	"email" text,
	"full_name" text NOT NULL,
	"preferred_language" text DEFAULT 'en' NOT NULL,
	"password_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"guest_id" uuid NOT NULL,
	"status" "stay_status" DEFAULT 'RESERVED' NOT NULL,
	"source" "stay_source" DEFAULT 'FRONT_DESK' NOT NULL,
	"source_ref_id" text,
	"checked_in_at" timestamp with time zone,
	"checked_out_at" timestamp with time zone,
	"scheduled_checkout_at" timestamp with time zone NOT NULL,
	"adults" integer DEFAULT 1 NOT NULL,
	"children" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cart_item_modifiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cart_item_id" uuid NOT NULL,
	"modifier_option_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cart_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cart_id" uuid NOT NULL,
	"menu_item_id" uuid NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "carts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"stay_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_item_modifiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"modifier_option_id" uuid,
	"name_snapshot" text NOT NULL,
	"price_delta_minor" integer NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"menu_item_id" uuid,
	"name_snapshot" text NOT NULL,
	"unit_price_minor" integer NOT NULL,
	"image_url_snapshot" text,
	"currency" text DEFAULT 'INR' NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"line_total_minor" integer NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"stay_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"order_number" text NOT NULL,
	"status" "order_status" DEFAULT 'DRAFT' NOT NULL,
	"subtotal_minor" integer DEFAULT 0 NOT NULL,
	"tax_minor" integer DEFAULT 0 NOT NULL,
	"service_charge_minor" integer DEFAULT 0 NOT NULL,
	"delivery_fee_minor" integer DEFAULT 0 NOT NULL,
	"tip_minor" integer DEFAULT 0 NOT NULL,
	"total_minor" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"dietary_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"guest_notes" text,
	"placed_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"preparing_at" timestamp with time zone,
	"ready_at" timestamp with time zone,
	"out_for_delivery_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"promised_by_at" timestamp with time zone,
	"rejection_reason" text,
	"cancellation_reason" text,
	"assigned_runner_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text DEFAULT 'AMENITY' NOT NULL,
	"icon_key" text,
	"price_minor" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"is_chargeable" boolean DEFAULT false NOT NULL,
	"sla_minutes" integer DEFAULT 15 NOT NULL,
	"route_to_role_key" text NOT NULL,
	"allows_quantity" boolean DEFAULT false NOT NULL,
	"max_quantity" integer DEFAULT 1 NOT NULL,
	"allows_note" boolean DEFAULT true NOT NULL,
	"allows_photo" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_request_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"service_request_id" uuid NOT NULL,
	"request_type_id" uuid,
	"label_snapshot" text NOT NULL,
	"unit_price_minor" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"line_total_minor" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"stay_id" uuid NOT NULL,
	"floor_id" uuid NOT NULL,
	"request_type_id" uuid,
	"request_number" text NOT NULL,
	"status" "service_request_status" DEFAULT 'OPEN' NOT NULL,
	"guest_note" text,
	"photo_url" text,
	"total_minor" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"sla_target_at" timestamp with time zone,
	"escalated_at" timestamp with time zone,
	"escalation_level" integer DEFAULT 0 NOT NULL,
	"assigned_staff_id" uuid,
	"assigned_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"rejection_reason" text,
	"cancellation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"recipient_staff_id" uuid,
	"recipient_guest_session_id" uuid,
	"recipient_address" text,
	"entity_type" text,
	"entity_id" uuid,
	"template" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "access_escalations" ADD CONSTRAINT "access_escalations_guest_session_id_guest_sessions_id_fk" FOREIGN KEY ("guest_session_id") REFERENCES "public"."guest_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_sessions" ADD CONSTRAINT "guest_sessions_stay_id_stays_id_fk" FOREIGN KEY ("stay_id") REFERENCES "public"."stays"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_sessions" ADD CONSTRAINT "guest_sessions_scanned_qr_code_id_room_qr_codes_id_fk" FOREIGN KEY ("scanned_qr_code_id") REFERENCES "public"."room_qr_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_vouches" ADD CONSTRAINT "staff_vouches_stay_id_stays_id_fk" FOREIGN KEY ("stay_id") REFERENCES "public"."stays"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_vouches" ADD CONSTRAINT "staff_vouches_guest_session_id_guest_sessions_id_fk" FOREIGN KEY ("guest_session_id") REFERENCES "public"."guest_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_vouches" ADD CONSTRAINT "staff_vouches_staff_user_id_staff_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_challenges" ADD CONSTRAINT "verification_challenges_stay_id_stays_id_fk" FOREIGN KEY ("stay_id") REFERENCES "public"."stays"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_challenges" ADD CONSTRAINT "verification_challenges_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folio_lines" ADD CONSTRAINT "folio_lines_folio_id_folios_id_fk" FOREIGN KEY ("folio_id") REFERENCES "public"."folios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folios" ADD CONSTRAINT "folios_stay_id_stays_id_fk" FOREIGN KEY ("stay_id") REFERENCES "public"."stays"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_folio_id_folios_id_fk" FOREIGN KEY ("folio_id") REFERENCES "public"."folios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_categories" ADD CONSTRAINT "menu_categories_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_item_availability_windows" ADD CONSTRAINT "menu_item_availability_windows_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_item_modifier_groups" ADD CONSTRAINT "menu_item_modifier_groups_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_item_modifier_groups" ADD CONSTRAINT "menu_item_modifier_groups_modifier_group_id_modifier_groups_id_fk" FOREIGN KEY ("modifier_group_id") REFERENCES "public"."modifier_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_category_id_menu_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."menu_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modifier_groups" ADD CONSTRAINT "modifier_groups_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modifier_options" ADD CONSTRAINT "modifier_options_group_id_modifier_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."modifier_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outlet_hours" ADD CONSTRAINT "outlet_hours_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itineraries" ADD CONSTRAINT "itineraries_stay_id_stays_id_fk" FOREIGN KEY ("stay_id") REFERENCES "public"."stays"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itinerary_stops" ADD CONSTRAINT "itinerary_stops_itinerary_id_itineraries_id_fk" FOREIGN KEY ("itinerary_id") REFERENCES "public"."itineraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itinerary_stops" ADD CONSTRAINT "itinerary_stops_poi_id_pois_id_fk" FOREIGN KEY ("poi_id") REFERENCES "public"."pois"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_zones" ADD CONSTRAINT "shift_zones_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_zones" ADD CONSTRAINT "shift_zones_floor_id_floors_id_fk" FOREIGN KEY ("floor_id") REFERENCES "public"."floors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_staff_user_id_staff_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_qr_codes" ADD CONSTRAINT "room_qr_codes_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_floor_id_floors_id_fk" FOREIGN KEY ("floor_id") REFERENCES "public"."floors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_room_type_id_room_types_id_fk" FOREIGN KEY ("room_type_id") REFERENCES "public"."room_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_property_roles" ADD CONSTRAINT "staff_property_roles_staff_user_id_staff_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_property_roles" ADD CONSTRAINT "staff_property_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_sessions" ADD CONSTRAINT "staff_sessions_staff_user_id_staff_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_requests" ADD CONSTRAINT "checkout_requests_stay_id_stays_id_fk" FOREIGN KEY ("stay_id") REFERENCES "public"."stays"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_property_profiles" ADD CONSTRAINT "guest_property_profiles_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stays" ADD CONSTRAINT "stays_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stays" ADD CONSTRAINT "stays_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_item_modifiers" ADD CONSTRAINT "cart_item_modifiers_cart_item_id_cart_items_id_fk" FOREIGN KEY ("cart_item_id") REFERENCES "public"."cart_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_item_modifiers" ADD CONSTRAINT "cart_item_modifiers_modifier_option_id_modifier_options_id_fk" FOREIGN KEY ("modifier_option_id") REFERENCES "public"."modifier_options"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_stay_id_stays_id_fk" FOREIGN KEY ("stay_id") REFERENCES "public"."stays"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item_modifiers" ADD CONSTRAINT "order_item_modifiers_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item_modifiers" ADD CONSTRAINT "order_item_modifiers_modifier_option_id_modifier_options_id_fk" FOREIGN KEY ("modifier_option_id") REFERENCES "public"."modifier_options"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_stay_id_stays_id_fk" FOREIGN KEY ("stay_id") REFERENCES "public"."stays"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_request_items" ADD CONSTRAINT "service_request_items_service_request_id_service_requests_id_fk" FOREIGN KEY ("service_request_id") REFERENCES "public"."service_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_request_items" ADD CONSTRAINT "service_request_items_request_type_id_request_types_id_fk" FOREIGN KEY ("request_type_id") REFERENCES "public"."request_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_stay_id_stays_id_fk" FOREIGN KEY ("stay_id") REFERENCES "public"."stays"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_floor_id_floors_id_fk" FOREIGN KEY ("floor_id") REFERENCES "public"."floors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_request_type_id_request_types_id_fk" FOREIGN KEY ("request_type_id") REFERENCES "public"."request_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_assigned_staff_id_staff_users_id_fk" FOREIGN KEY ("assigned_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_escalations_session_idx" ON "access_escalations" USING btree ("guest_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "access_policies_property_uq" ON "access_policies" USING btree ("property_id");--> statement-breakpoint
CREATE UNIQUE INDEX "guest_sessions_token_hash_uq" ON "guest_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "guest_sessions_stay_idx" ON "guest_sessions" USING btree ("stay_id");--> statement-breakpoint
CREATE INDEX "staff_vouches_stay_idx" ON "staff_vouches" USING btree ("stay_id");--> statement-breakpoint
CREATE INDEX "verification_challenges_room_idx" ON "verification_challenges" USING btree ("room_id","created_at");--> statement-breakpoint
CREATE INDEX "verification_challenges_stay_idx" ON "verification_challenges" USING btree ("stay_id");--> statement-breakpoint
CREATE INDEX "folio_lines_folio_idx" ON "folio_lines" USING btree ("folio_id","created_at");--> statement-breakpoint
CREATE INDEX "folio_lines_pms_sweep_idx" ON "folio_lines" USING btree ("property_id","pms_posted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "folios_stay_uq" ON "folios" USING btree ("stay_id");--> statement-breakpoint
CREATE INDEX "payments_folio_idx" ON "payments" USING btree ("folio_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_payment_uq" ON "payments" USING btree ("provider","provider_payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "collection_items_uq" ON "collection_items" USING btree ("collection_id","menu_item_id");--> statement-breakpoint
CREATE INDEX "collections_outlet_idx" ON "collections" USING btree ("outlet_id","sort_order");--> statement-breakpoint
CREATE INDEX "menu_categories_outlet_idx" ON "menu_categories" USING btree ("outlet_id","sort_order");--> statement-breakpoint
CREATE INDEX "menu_item_availability_windows_item_idx" ON "menu_item_availability_windows" USING btree ("menu_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "menu_item_modifier_groups_uq" ON "menu_item_modifier_groups" USING btree ("menu_item_id","modifier_group_id");--> statement-breakpoint
CREATE INDEX "menu_items_category_sort_idx" ON "menu_items" USING btree ("category_id","sort_order");--> statement-breakpoint
CREATE INDEX "menu_items_outlet_available_idx" ON "menu_items" USING btree ("outlet_id","is_available");--> statement-breakpoint
CREATE INDEX "modifier_groups_outlet_idx" ON "modifier_groups" USING btree ("outlet_id");--> statement-breakpoint
CREATE INDEX "modifier_options_group_idx" ON "modifier_options" USING btree ("group_id","sort_order");--> statement-breakpoint
CREATE INDEX "outlet_hours_outlet_idx" ON "outlet_hours" USING btree ("outlet_id","day_of_week");--> statement-breakpoint
CREATE INDEX "outlets_property_idx" ON "outlets" USING btree ("property_id","kind");--> statement-breakpoint
CREATE INDEX "itineraries_stay_idx" ON "itineraries" USING btree ("stay_id");--> statement-breakpoint
CREATE INDEX "itinerary_stops_itinerary_idx" ON "itinerary_stops" USING btree ("itinerary_id","sort_order");--> statement-breakpoint
CREATE INDEX "pois_property_category_idx" ON "pois" USING btree ("property_id","category","walk_minutes");--> statement-breakpoint
CREATE INDEX "event_log_entity_idx" ON "event_log" USING btree ("entity_type","entity_id","occurred_at");--> statement-breakpoint
CREATE INDEX "event_log_property_idx" ON "event_log" USING btree ("property_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_keys_scope_key_uq" ON "idempotency_keys" USING btree ("tenant_id","scope","key");--> statement-breakpoint
CREATE INDEX "integration_outbox_sweep_idx" ON "integration_outbox" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "shift_zones_uq" ON "shift_zones" USING btree ("shift_id","floor_id");--> statement-breakpoint
CREATE INDEX "shifts_property_status_idx" ON "shifts" USING btree ("property_id","status");--> statement-breakpoint
CREATE INDEX "shifts_staff_idx" ON "shifts" USING btree ("staff_user_id","scheduled_start_at");--> statement-breakpoint
CREATE UNIQUE INDEX "floors_property_level_uq" ON "floors" USING btree ("property_id","level");--> statement-breakpoint
CREATE UNIQUE INDEX "properties_tenant_slug_uq" ON "properties" USING btree ("tenant_id","slug");--> statement-breakpoint
CREATE INDEX "properties_tenant_idx" ON "properties" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "role_permissions_role_perm_uq" ON "role_permissions" USING btree ("role_id","permission");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_tenant_property_key_uq" ON "roles" USING btree ("tenant_id","property_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "room_qr_codes_public_code_uq" ON "room_qr_codes" USING btree ("public_code");--> statement-breakpoint
CREATE INDEX "room_qr_codes_room_idx" ON "room_qr_codes" USING btree ("room_id");--> statement-breakpoint
CREATE UNIQUE INDEX "room_types_property_code_uq" ON "room_types" USING btree ("property_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "rooms_property_number_uq" ON "rooms" USING btree ("property_id","number");--> statement-breakpoint
CREATE INDEX "rooms_property_floor_idx" ON "rooms" USING btree ("property_id","floor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_property_roles_uq" ON "staff_property_roles" USING btree ("staff_user_id","property_id","role_id");--> statement-breakpoint
CREATE INDEX "staff_property_roles_staff_idx" ON "staff_property_roles" USING btree ("staff_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_sessions_token_hash_uq" ON "staff_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "staff_sessions_staff_idx" ON "staff_sessions" USING btree ("staff_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_users_tenant_email_uq" ON "staff_users" USING btree ("tenant_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_slug_uq" ON "tenants" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "checkout_requests_stay_idx" ON "checkout_requests" USING btree ("stay_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "guest_property_profiles_uq" ON "guest_property_profiles" USING btree ("property_id","guest_id");--> statement-breakpoint
CREATE UNIQUE INDEX "guests_tenant_phone_uq" ON "guests" USING btree ("tenant_id","phone");--> statement-breakpoint
CREATE INDEX "stays_property_status_idx" ON "stays" USING btree ("property_id","status");--> statement-breakpoint
CREATE INDEX "stays_room_idx" ON "stays" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "stays_guest_idx" ON "stays" USING btree ("guest_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cart_item_modifiers_uq" ON "cart_item_modifiers" USING btree ("cart_item_id","modifier_option_id");--> statement-breakpoint
CREATE INDEX "cart_items_cart_idx" ON "cart_items" USING btree ("cart_id");--> statement-breakpoint
CREATE UNIQUE INDEX "carts_stay_outlet_uq" ON "carts" USING btree ("stay_id","outlet_id");--> statement-breakpoint
CREATE INDEX "order_item_modifiers_item_idx" ON "order_item_modifiers" USING btree ("order_item_id");--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_property_number_uq" ON "orders" USING btree ("property_id","order_number");--> statement-breakpoint
CREATE INDEX "orders_kds_idx" ON "orders" USING btree ("outlet_id","status","placed_at");--> statement-breakpoint
CREATE INDEX "orders_stay_idx" ON "orders" USING btree ("stay_id");--> statement-breakpoint
CREATE INDEX "request_types_property_idx" ON "request_types" USING btree ("property_id","category","sort_order");--> statement-breakpoint
CREATE INDEX "service_request_items_request_idx" ON "service_request_items" USING btree ("service_request_id");--> statement-breakpoint
CREATE INDEX "service_requests_board_idx" ON "service_requests" USING btree ("property_id","status","sla_target_at");--> statement-breakpoint
CREATE INDEX "service_requests_assignee_idx" ON "service_requests" USING btree ("assigned_staff_id","status");--> statement-breakpoint
CREATE INDEX "service_requests_stay_idx" ON "service_requests" USING btree ("stay_id");--> statement-breakpoint
CREATE INDEX "notifications_recipient_idx" ON "notifications" USING btree ("recipient_staff_id","status");--> statement-breakpoint
CREATE INDEX "notifications_entity_idx" ON "notifications" USING btree ("entity_type","entity_id");
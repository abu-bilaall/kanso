/**
 * Hand-written Supabase database types.
 *
 * FROZEN CONTRACT SURFACE — written from `SPEC.md` during Phase 1 so that no
 * downstream agent is blocked waiting for migrations to exist.
 *
 * The data agent (A1) replaces this file wholesale with the output of
 * `supabase gen types typescript --local` once the migrations land. If that
 * regeneration changes anything in here, that is a contract change: it gets
 * recorded in `docs/CONTRACT-REQUESTS.md`, not silently patched. See
 * `docs/CONTRACTS.md`.
 *
 * Shape note: the nested `Row` / `Insert` / `Update` / `Relationships` structure
 * is what `supabase-js` expects. `Insert` marks defaulted columns optional and
 * makes the rest required; `Update` makes everything optional. `Relationships`
 * is what makes embedded selects type-check:
 *
 *   supabase.from('cart_items').select('*, product:products(*)')
 *
 * Monetary columns are `number` and hold **integer kobo**. Never floats.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

/** The three catalogue divisions. Order is the storefront's display order. */
export const PRODUCT_CATEGORIES = ['desk', 'carry', 'write'] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

/** Cart lifecycle: `active` while it can be mutated, `closed` once ordered. */
export type CartStatus = 'active' | 'closed';

/**
 * Order status. V1 creates orders as `confirmed`; the remaining states exist so
 * downstream code never has to widen the type later.
 */
export type OrderStatus = 'pending' | 'confirmed' | 'cancelled';

export type ProductRow = {
  id: string;
  slug: string;
  name: string;
  category: ProductCategory;
  /** The short technical line shown under the name, e.g. `18oz dry-waxed canvas / 13"`. */
  spec_line: string | null;
  description: string | null;
  /** Integer kobo. Authoritative; the browser never computes a price. */
  price_kobo: number;
  /** Units available. Decremented server-side by `create-order`. */
  inventory: number;
  /** Storage object path or public URL. Resolved for display by the media agent. */
  image_path: string | null;
  created_at: string;
  updated_at: string;
};

export type ProfileRow = {
  /** Equals `auth.users.id`. One-to-one. */
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  phone: string | null;
  created_at: string;
  updated_at: string;
};

export type CartRow = {
  id: string;
  user_id: string;
  status: CartStatus;
  created_at: string;
  updated_at: string;
  /** Set when the cart is closed by `create-order`. Null while active. */
  closed_at: string | null;
};

export type CartItemRow = {
  id: string;
  cart_id: string;
  product_id: string;
  /** Always >= 1. A product appears at most once per cart. */
  quantity: number;
  created_at: string;
  updated_at: string;
};

export type OrderRow = {
  id: string;
  /** Human-facing reference, e.g. `KS-8902-DX`. Shown in the UI and the email. */
  reference: string;
  user_id: string;
  status: OrderStatus;
  email: string;
  phone: string;
  full_name: string;
  address_line1: string;
  address_line2: string | null;
  city: string;
  state: string;
  country: string;
  /** Integer kobo. Sum of the order item snapshots; computed server-side only. */
  subtotal_kobo: number;
  /** Integer kobo. V1 has no shipping charge, so this equals `subtotal_kobo`. */
  total_kobo: number;
  created_at: string;
  updated_at: string;
};

export type OrderItemRow = {
  id: string;
  order_id: string;
  product_id: string;
  /** Snapshot of the product name at purchase time. */
  product_name: string;
  quantity: number;
  /** Snapshot of the unit price at purchase time, integer kobo. */
  unit_price_kobo: number;
  created_at: string;
};

/**
 * A foreign-key relationship, in the shape `supabase-js` expects. Declaring
 * these is what makes an embedded select type-check:
 *
 *   .from('cart_items').select('*, product:products(*)')
 *
 * `foreignKeyName` matches the constraint name A1 gives in the migration.
 * Regenerating the types replaces these automatically.
 */
export interface Relationship {
  foreignKeyName: string;
  columns: string[];
  isOneToOne: boolean;
  referencedRelation: string;
  referencedColumns: string[];
}

/** Every user-owned table points at `auth.users` through `user_id`. */
type UserFk = {
  foreignKeyName: 'profiles_id_fkey';
  columns: ['user_id'];
  isOneToOne: false;
  referencedRelation: 'users';
  referencedColumns: ['id'];
};

/** Two parents per line: the cart it belongs to and the product it points at. */
type CartItemsRelationships = [
  {
    foreignKeyName: 'cart_items_cart_id_fkey';
    columns: ['cart_id'];
    isOneToOne: false;
    referencedRelation: 'carts';
    referencedColumns: ['id'];
  },
  {
    foreignKeyName: 'cart_items_product_id_fkey';
    columns: ['product_id'];
    isOneToOne: false;
    referencedRelation: 'products';
    referencedColumns: ['id'];
  },
];

type OrderItemsRelationships = [
  {
    foreignKeyName: 'order_items_order_id_fkey';
    columns: ['order_id'];
    isOneToOne: false;
    referencedRelation: 'orders';
    referencedColumns: ['id'];
  },
  {
    foreignKeyName: 'order_items_product_id_fkey';
    columns: ['product_id'];
    isOneToOne: false;
    referencedRelation: 'products';
    referencedColumns: ['id'];
  },
];

export interface Database {
  public: {
    Tables: {
      products: {
        Row: ProductRow;
        Insert: Omit<ProductRow, 'id' | 'created_at' | 'updated_at'> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<ProductRow>;
        Relationships: [];
      };
      profiles: {
        Row: ProfileRow;
        Insert: Omit<ProfileRow, 'created_at' | 'updated_at'> & {
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<ProfileRow>;
        Relationships: [];
      };
      carts: {
        Row: CartRow;
        Insert: Omit<CartRow, 'id' | 'created_at' | 'updated_at' | 'closed_at'> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
          closed_at?: string | null;
        };
        Update: Partial<CartRow>;
        Relationships: [UserFk];
      };
      cart_items: {
        Row: CartItemRow;
        Insert: Omit<CartItemRow, 'id' | 'created_at' | 'updated_at'> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<CartItemRow>;
        Relationships: CartItemsRelationships;
      };
      orders: {
        Row: OrderRow;
        Insert: Omit<OrderRow, 'id' | 'created_at' | 'updated_at' | 'reference'> & {
          id?: string;
          reference?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<OrderRow>;
        Relationships: [UserFk];
      };
      order_items: {
        Row: OrderItemRow;
        Insert: Omit<OrderItemRow, 'id' | 'created_at'> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<OrderItemRow>;
        Relationships: OrderItemsRelationships;
      };
    };
    Views: Record<never, never>;
    Functions: Record<never, never>;
    Enums: {
      product_category: ProductCategory;
      cart_status: CartStatus;
      order_status: OrderStatus;
    };
    CompositeTypes: Record<never, never>;
  };
}

/* ===========================================================================
   Domain aliases
   ---------------------------------------------------------------------------
   Components and hooks import these, never the raw `*Row` types. If the data
   agent's regenerated `supabase.types.ts` renames a column, only the alias block
   below has to change.
   =========================================================================== */

export type Product = ProductRow;
export type Profile = ProfileRow;
export type Cart = CartRow;
export type CartItem = CartItemRow;
export type Order = OrderRow;
export type OrderItem = OrderItemRow;

/**
 * A cart item with its product joined in. `product` is never null for a row that
 * came back from the join, but the type says it may be so a caller that hit a
 * deleted product renders a fallback rather than crashing.
 */
export interface CartItemWithProduct extends CartItem {
  product: Product | null;
}

/** An order item with its product joined in, for the order detail view. */
export interface OrderItemWithProduct extends OrderItem {
  product: Pick<Product, 'id' | 'slug' | 'name'> | null;
}

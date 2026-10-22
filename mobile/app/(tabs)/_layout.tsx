import { Tabs } from 'expo-router';
import { House, ReceiptText, Search, User } from 'lucide-react-native';
import { colors, space, text as type, face, TAB_BAR_H, TOUCH_MIN } from '@/lib/theme';

/**
 * The tab bar. Phase 1 of the app redesign.
 *
 * ─── Why this is the change that matters most ─────────────────────────────
 *
 * Every screen used to be a push onto one stack with a back arrow in the
 * corner, which is the shape of a WEBSITE. An app has places you can be, and
 * you move between them sideways rather than by retreating. That difference
 * is most of what "it feels basic" was describing, and it costs nothing to
 * fix — no new data, no new screens, and no photography.
 *
 * ─── Four tabs, since phase 3 ─────────────────────────────────────────────
 *
 * Search was deliberately absent from this bar for one phase, and the note
 * that used to be here said why: searching a menu properly needs an endpoint
 * — ten dishes filter fine in the client, sixty do not, and a real property
 * has sixty. `GET /menu/search` is what phase 3 built, so the tab is here and
 * it is the server answering it.
 *
 * It sits SECOND, between Order and Orders, which is where its own screen
 * argues from: searching is something you do instead of scrolling the menu,
 * so it belongs beside the menu rather than beside your history. The two
 * neighbours are also why the labels are "Order" and "Orders" and not
 * "Menu" and "Orders" — the first tab is the act, the third is the record.
 *
 * ─── What is NOT a tab ────────────────────────────────────────────────────
 *
 * Menu, dish, cart, order tracking, sign-in and addresses all stay on the
 * root stack, above this. They are things you are DOING, and they end — you
 * come back to where you were, so they push and pop. The tabs are the three
 * places the app is: what is cooking, what you ordered, and who you are.
 *
 * ─── And no global cart bar ───────────────────────────────────────────────
 *
 * The obvious move is a cart strip rendered here, above the tabs, on every
 * screen. It was written and then taken out: `HomeBottomBar` already is that
 * bar on the one screen where food is added, and it carries a page of
 * reasoning about which face it shows and how it cross-fades. A second
 * implementation would be a second opinion about the total, stacked directly
 * on top of the first.
 *
 * Orders and Account are not screens anybody adds food from, so what they
 * would gain is a reminder rather than a control. If that turns out to be
 * worth having, it belongs INSIDE `HomeBottomBar` as a hoist, not beside it.
 */
export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.inkFaint,
        tabBarStyle: {
          backgroundColor: colors.paper,
          borderTopColor: colors.line,
          borderTopWidth: 1,
          // Taller than the platform default. The bar sits under a thumb on
          // a phone held one-handed, which is how somebody orders standing
          // in a lobby.
          height: TAB_BAR_H,
          paddingTop: space[2],
          paddingBottom: space[3],
        },
        tabBarLabelStyle: { fontSize: type.xs, ...face('bodyMedium') },
        tabBarItemStyle: { minHeight: TOUCH_MIN },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: 'Order',
          tabBarIcon: ({ color, size }) => <House color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: 'Search',
          tabBarIcon: ({ color, size }) => <Search color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: 'Orders',
          tabBarIcon: ({ color, size }) => <ReceiptText color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: 'Account',
          tabBarIcon: ({ color, size }) => <User color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}

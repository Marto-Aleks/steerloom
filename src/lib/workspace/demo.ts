import type { FlowBoardSnapshot } from '../../types'

/** Fictional product work, so the demo's keys read like a real board on hover. */
const DEMO_TITLES = [
  'Checkout: retry failed payments once before showing an error',
  'Order history page loads twice on first visit',
  'Add gift message field to cart',
  'Password reset email arrives in the wrong language',
  'Show delivery estimate on the product page',
  'Search results ignore the colour filter',
  'Save basket between sessions',
  'Promo code box accepts spaces and then fails',
  'Let customers pick a delivery day',
  'Receipt PDF is missing the VAT line',
  'One-tap reorder from the orders list',
  'Account page shows a blank name after sign-up with Google',
  'Low-stock badge on product cards',
  'Wishlist share link opens an empty page',
  'Address form: suggest the city from the postcode',
  'Mobile menu overlaps the cookie banner',
  'Support chat: show order number automatically',
  'Review stars are unreadable in dark mode',
  'Split a delivery into two parcels',
  'Returns form rejects valid order numbers',
  'Keep filters when going back to search',
  'Track-my-parcel page times out on slow connections',
  'Add size guide to clothing items',
  'Duplicate notification after a cancelled order',
  'Show "ships from" country on checkout',
  'Logged-out checkout loses the gift message',
  'Loyalty points balance on the home page',
  'Search autocomplete suggests out-of-stock items',
  'Replace the date picker on the returns form',
  'Apple Pay button hidden on small screens',
  'Email receipts: add a reorder button',
  'Sort "newest first" shows last week\'s items',
  'Bundle discounts for matching sets',
  'Rounding error on multi-currency totals',
  'Remember the last used delivery address',
  'Image zoom stuck on the first photo',
  'Guest checkout asks for a password twice',
  'Show stock per store on the product page',
  'Basket total ignores the student discount',
  'Add Klarna as a payment option',
  'Order confirmation email lands in spam for Outlook users',
  'Let customers edit an order within 15 minutes',
  'Country selector lists Ireland twice',
  'Product video autoplays with sound on mobile',
  'Add "notify me" for out-of-stock sizes',
  'Delivery slot picker skips bank holidays incorrectly',
  'Faster image loading on the category pages',
  'Reviews: allow photos from customers',
  'Cancelled orders still count towards loyalty tier',
  'Searching for "trousers" returns no results',
  'Show order status timeline on the tracking page',
  'Cookie banner reappears after every page load in Safari',
  'Add a "buy again" row to the home page',
  'Saved cards expire a month early',
  'Returns label PDF opens blank on Android',
  'Recently viewed items on the product page',
  'Gift cards cannot be combined with promo codes',
  'Price alerts for wishlist items',
  'Chat widget covers the "place order" button on small phones',
  'Store finder: open now filter',
  'Vouchers show the wrong currency symbol',
  'Add Google Pay to the checkout',
  'Account deletion leaves the newsletter subscription active',
  'Show estimated tax before the payment step',
  'Order search in the account page',
  'Product comparison for up to four items',
  'Discount banner overlaps the search box on tablets',
  'Breadcrumbs lose the category after a filter change',
  'Allow two delivery addresses on one order',
  'Default sort should be relevance, not price',
  'Basket shows a stale price after a sale ends',
  'Invoice download for business customers',
  'Subscription orders: skip the next delivery',
  'Newsletter sign-up ignores the opt-in checkbox',
  'Quick view on category pages',
  'Return reasons dropdown is empty for exchanges',
  'Simpler address entry for apartments',
  'Social login with Apple',
  'Free-delivery progress bar in the basket',
  'Order total is rounded differently in the email',
  'Pre-orders with a visible ship date',
  'Filter chips disappear on scroll',
  'Share a basket with a link',
  "Wrong size chart on children's shoes",
  'Live stock counter on the last few items',
  'Marketplace sellers: show the dispatch time',
  'Payment page reloads when the card number is pasted',
  'Loyalty points shown on the receipt',
  'Delivery address autocomplete for Ireland',
  'Thumbnails load in the wrong order on the product page',
  'Reserve in store and pay at pickup',
  'Checkout progress bar for the three steps',
  'Promo codes case-insensitive',
  'Cart drawer traps keyboard focus',
  'Try-before-you-buy for shoes',
  'Order history pagination loses the active filter',
] as const

/*
 * Six months of finished work, oldest week first. Each row is one week and
 * each number is how many days an item took from In progress to Done. The
 * team starts slow, with long reviews and the odd quiet week, and gets
 * faster over the last three months, so the trends read as a real story.
 * The last row is the current week. Keys 30–36 stay on the seven active
 * items: the film and the docs refer to them.
 */
const FINISHED_WEEKS: number[][] = [
  [9.2, 6.5, 12.8],
  [7.4, 10.1],
  [8.6, 5.9, 14.2, 7.7],
  [11.3, 6.8],
  [9.8, 8.1, 4.6],
  [13.5, 7.2],
  [6.1, 9.4, 10.6],
  [8.9],
  [7.8, 12.1, 5.4, 9.0],
  [10.9, 6.3],
  [8.4, 7.1, 15.6],
  [9.6, 5.8, 8.3],
  [11.8, 7.5],
  [6.9, 8.2, 9.7],
  [7.6, 4.8, 10.4],
  [6.2, 8.8, 7.3],
  [9.1, 4.3],
  [5.7, 8.4, 9.1],
  [4.4, 6.7, 5.2, 7.8],
  [7.0, 3.6, 10.4],
  [4.9, 6.4, 2.8, 5.3, 8.2],
  [3.7, 5.6, 7.0, 4.2],
  [6.1, 2.9, 4.8, 5.4, 8.6],
  [3.3, 7.4, 4.5, 7.0],
  [5.0, 2.6, 4.1, 7.0, 3.8],
  [4.6, 3.1, 5.9],
]
/** Days into its week at which each item of a row finishes. */
const FINISH_DAYS = [0.4, 1.3, 2.6, 3.5, 4.4, 5.2, 6.1]
const ACTIVE_KEYS = [30, 31, 32, 33, 34, 35, 36]

export function demoSnapshot(
  boardId = 'demo-product',
  now = new Date(),
): FlowBoardSnapshot {
  const stages = ['Backlog', 'In progress', 'Review', 'Done']
  const date = (daysAgo: number) =>
    new Date(now.getTime() - daysAgo * 86_400_000).toISOString()
  const issues: FlowBoardSnapshot['issues'] = []
  const transitions: FlowBoardSnapshot['transitions'] = []
  const add = (
    key: number,
    index: number,
    started: number,
    history: { statusId: string; daysAgo: number }[],
  ) => {
    const id = `${boardId}-${key}`
    issues.push({
      id,
      key: `DEMO-${key}`,
      issueTypeId: index % 4 === 0 ? 'bug' : 'story',
      issueTypeName: index % 4 === 0 ? 'Bug' : 'Story',
      createdAt: date(started + 3 + (index % 5)),
      title: DEMO_TITLES[index % DEMO_TITLES.length]!,
    })
    for (const step of history) {
      transitions.push({
        issueId: id,
        statusId: step.statusId,
        enteredAt: date(step.daysAgo),
      })
    }
  }

  let key = 0
  let index = 0
  FINISHED_WEEKS.forEach((week, row) => {
    week.forEach((cycle, slot) => {
      key++
      while (ACTIVE_KEYS.includes(key)) key++
      const finish = 7 * (FINISHED_WEEKS.length - 1 - row) + FINISH_DAYS[slot]!
      const started = finish + cycle
      const review = finish + cycle * (0.3 + 0.1 * (index % 3))
      add(key, index, started, [
        { statusId: 'stage-0', daysAgo: started + 3 + (index % 5) },
        { statusId: 'stage-1', daysAgo: started },
        { statusId: 'stage-2', daysAgo: review },
        { statusId: 'stage-3', daysAgo: finish },
      ])
      index++
    })
  })

  // Seven items in progress, the oldest well past the usual limit; DEMO-32
  // was closed once and reopened.
  ACTIVE_KEYS.forEach((active, position) => {
    const started = 2 + position * 3
    add(active, active - 1, started, [
      { statusId: 'stage-0', daysAgo: started + 4 },
      { statusId: 'stage-1', daysAgo: started },
      ...(active === 32
        ? [
            { statusId: 'stage-3', daysAgo: started - 1 },
            { statusId: 'stage-1', daysAgo: started - 2 },
          ]
        : []),
    ])
  })

  return {
    source: { kind: 'demo', label: 'Fictional sample data' },
    board: {
      id: boardId,
      name:
        boardId === 'demo-product'
          ? 'Product delivery · Demo'
          : 'Platform delivery · Demo',
      statuses: stages.map((name, index) => ({ id: `stage-${index}`, name })),
      columns: stages.map((name, index) => ({
        id: `stage-${index}`,
        name,
        statusIds: [`stage-${index}`],
      })),
    },
    issues,
    transitions,
    loadedAt: now.toISOString(),
  }
}

/** Page navigation, replaceable in tests (jsdom cannot navigate). */
export const entryNavigation = {
  assign: (url: string) => window.location.assign(url),
}

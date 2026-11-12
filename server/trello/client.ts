import { fetch, ProxyAgent, type Dispatcher } from 'undici'
import { fetchWithRetry } from '../http/fetch-retry'
import type {
  TrelloAction,
  TrelloBoardHistory,
  TrelloCard,
  TrelloList,
} from '../../src/lib/data-source/trello'
import type { ProgressReporter } from '../http/progress'
import {
  BOARD_PROGRESS,
  foundDetail,
} from '../../src/lib/workspace/board-progress'

export interface TrelloAiBoard {
  lists: Array<{ id: string; name: string; closed?: boolean }>
  cards: Array<{
    id: string
    idShort: number
    name: string
    idList: string
    idMembers?: string[]
    dateLastActivity?: string
    due?: string | null
    closed?: boolean
    labels?: Array<{ name?: string; color?: string }>
  }>
  members: Array<{ id: string; fullName?: string; username?: string }>
}

export interface TrelloAiCard {
  name?: string
  desc?: string
  actions?: Array<{
    type?: string
    date?: string
    data?: {
      text?: string
      listBefore?: { name?: string }
      listAfter?: { name?: string }
      old?: { closed?: boolean }
      card?: { closed?: boolean }
      idMember?: string
      member?: { name?: string }
    }
    memberCreator?: { fullName?: string }
  }>
  checklists?: Array<{
    name?: string
    checkItems?: Array<{ name?: string; state?: string }>
  }>
}

export class TrelloClient {
  private readonly dispatcher?: Dispatcher
  constructor(
    private readonly apiKey: string,
    private readonly token: string,
    proxyUrl?: string,
    private readonly accessToken?: () => Promise<string>,
  ) {
    if (proxyUrl) {
      try {
        const url = new URL(proxyUrl)
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error()
        this.dispatcher = new ProxyAgent(proxyUrl)
      } catch {
        throw new Error(
          'The Trello proxy setting is invalid. Set FLOWLENS_TRELLO_PROXY to an HTTP(S) proxy URL or direct, then restart Steerloom.',
        )
      }
    }
  }
  async boards(
    signal?: AbortSignal,
  ): Promise<Array<{ id: string; name: string; shortLink: string }>> {
    const boards = await this.get<
      Array<{ id: string; name: string; shortLink: string }>
    >(
      '/members/me/boards',
      { fields: 'name,shortLink', filter: 'open' },
      signal,
    )
    return boards.map(({ id, name, shortLink }) => ({ id, name, shortLink }))
  }
  async history(
    boardId: string,
    signal?: AbortSignal,
    onProgress?: ProgressReporter,
  ): Promise<TrelloBoardHistory> {
    if (!/^[a-f0-9]{24}$/.test(boardId))
      throw new Error('Invalid Trello board.')
    onProgress?.(BOARD_PROGRESS.board)
    const [board, lists, cards, members] = await Promise.all([
      this.get<{ id: string; name: string; shortLink: string }>(
        `/boards/${boardId}`,
        { fields: 'name' },
        signal,
      ),
      this.get<TrelloList[]>(
        `/boards/${boardId}/lists/all`,
        { fields: 'name,pos' },
        signal,
      ),
      this.get<TrelloCard[]>(
        `/boards/${boardId}/cards/all`,
        { fields: 'idShort,idList,closed,shortUrl,name,idMembers' },
        signal,
      ),
      this.get<Array<{ id: string; fullName?: string; username?: string }>>(
        `/boards/${boardId}/members`,
        { fields: 'fullName,username' },
        signal,
      ),
    ])
    if (cards.length > 5000)
      throw new Error(
        'This preview supports boards with up to 5,000 cards. Choose a smaller board.',
      )
    onProgress?.({ ...BOARD_PROGRESS.items, detail: foundDetail(cards.length) })
    const actions: TrelloAction[] = []
    let before = ''
    for (let page = 0; page < 20; page++) {
      onProgress?.(
        page
          ? {
              ...BOARD_PROGRESS.history,
              detail: `${actions.length.toLocaleString('en')} changes read`,
            }
          : BOARD_PROGRESS.history,
      )
      const batch = await this.get<TrelloAction[]>(
        `/boards/${boardId}/actions`,
        {
          filter: 'createCard,copyCard,updateCard:idList',
          limit: '1000',
          ...(before ? { before } : {}),
        },
        signal,
      )
      actions.push(...batch)
      if (batch.length < 1000) {
        onProgress?.(BOARD_PROGRESS.done)
        return {
          board: { id: board.id, name: board.name },
          lists: lists.map(({ id, name, pos }) => ({ id, name, pos })),
          cards: cards.map(
            ({ id, idShort, idList, closed, shortUrl, name, idMembers }) => ({
              id,
              idShort,
              idList,
              closed,
              shortUrl,
              name,
              idMembers: idMembers ?? [],
            }),
          ),
          members: members.map(({ id, fullName, username }) => ({
            id,
            name: fullName?.trim() || username?.trim() || 'Unknown',
          })),
          actions: actions.map(({ id, type, date, data }) => ({
            id,
            type,
            date,
            data: {
              card: data.card ? { id: data.card.id } : undefined,
              list: data.list ? { id: data.list.id } : undefined,
              listAfter: data.listAfter ? { id: data.listAfter.id } : undefined,
              old: data.old?.idList ? { idList: data.old.idList } : undefined,
            },
          })),
        }
      }
      const cursor = batch.at(-1)?.id
      if (!cursor || cursor === before)
        throw new Error(
          'Trello history pagination did not advance. Please retry.',
        )
      before = cursor
    }
    throw new Error(
      'The board exceeds the 20,000-event preview limit. No partial metrics were produced.',
    )
  }
  /**
   * The assistant's view of a board, read once per answer: every card with
   * its list, members, labels and last activity, plus the board's lists and
   * members, so searches can be answered without more requests.
   */
  async aiBoard(boardId: string, signal?: AbortSignal): Promise<TrelloAiBoard> {
    if (!/^[a-f0-9]{24}$/.test(boardId))
      throw new Error('Invalid Trello board.')
    const [lists, cards, members] = await Promise.all([
      this.get<TrelloAiBoard['lists']>(
        `/boards/${boardId}/lists/all`,
        { fields: 'name,closed' },
        signal,
      ),
      this.get<TrelloAiBoard['cards']>(
        `/boards/${boardId}/cards/all`,
        {
          fields:
            'idShort,name,idList,idMembers,dateLastActivity,due,closed,labels',
        },
        signal,
      ),
      this.get<TrelloAiBoard['members']>(
        `/boards/${boardId}/members`,
        { fields: 'fullName,username' },
        signal,
      ),
    ])
    if (cards.length > 5000)
      throw new Error(
        'This board has more than 5,000 cards, more than the assistant reads.',
      )
    return { lists, cards, members }
  }

  /** One card in full: description, checklists, comments and moves. */
  async aiCard(cardId: string, signal?: AbortSignal): Promise<TrelloAiCard> {
    if (!/^[a-f0-9]{24}$/.test(cardId)) throw new Error('Invalid Trello card.')
    return this.get<TrelloAiCard>(
      `/cards/${cardId}`,
      {
        fields: 'name,desc',
        actions:
          'commentCard,updateCard:idList,updateCard:closed,addMemberToCard,removeMemberFromCard',
        actions_limit: '60',
        action_fields: 'type,date,data',
        action_memberCreator_fields: 'fullName',
        checklists: 'all',
        checklist_fields: 'name',
      },
      signal,
    )
  }

  private async get<T>(
    path: string,
    params: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<T> {
    const url = new URL(
      `https://${this.accessToken ? 'trello.com' : 'api.trello.com'}/1${path}`,
    )
    Object.entries(params).forEach(([key, value]) =>
      url.searchParams.set(key, value),
    )
    let response
    const combined = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
      : AbortSignal.timeout(30_000)
    const authorization = this.accessToken
      ? `Bearer ${await this.accessToken()}`
      : `OAuth oauth_consumer_key="${this.apiKey}", oauth_token="${this.token}"`
    try {
      response = await fetchWithRetry(
        () =>
          fetch(url, {
            method: 'GET',
            redirect: 'error',
            dispatcher: this.dispatcher,
            headers: {
              Accept: 'application/json',
              Authorization: authorization,
            },
            signal: combined,
          }),
        { signal: combined },
      )
    } catch (error) {
      if (signal?.aborted) throw error
      throw new Error(trelloNetworkError(error, Boolean(this.dispatcher)))
    }
    if (!response.ok)
      throw new Error(
        response.status === 401
          ? 'Trello authorization expired or was revoked. Reconnect Trello.'
          : response.status === 429
            ? 'Trello rate limit reached. Wait and retry.'
            : 'Trello could not load this resource. Check board access.',
      )
    return (await response.json()) as T
  }
}

export function trelloNetworkError(
  error: unknown,
  usingProxy: boolean,
): string {
  const codes = new Set<string>()
  let current = error
  for (
    let depth = 0;
    depth < 5 && current && typeof current === 'object';
    depth++
  ) {
    if ('code' in current && typeof current.code === 'string')
      codes.add(current.code)
    if ('name' in current && typeof current.name === 'string')
      codes.add(current.name)
    current = 'cause' in current ? current.cause : undefined
  }
  const route = usingProxy
    ? 'Trello or the configured proxy hostname'
    : 'api.trello.com'
  if (codes.has('ENOTFOUND') || codes.has('EAI_AGAIN'))
    return `The local server could not resolve ${route}. Check your DNS/network or VPN. If your network requires a proxy, set FLOWLENS_TRELLO_PROXY in .env.local and restart Steerloom. Your token has not been validated.`
  if (codes.has('ECONNREFUSED'))
    return usingProxy
      ? 'The configured Trello proxy refused the connection. Check that the proxy is running and its host/port are correct. Set FLOWLENS_TRELLO_PROXY to use another approved proxy, or direct if your network permits it, then restart Steerloom.'
      : 'The connection to api.trello.com was refused. Check your network or VPN and whether an approved proxy is required.'
  if (
    [
      'TimeoutError',
      'ETIMEDOUT',
      'UND_ERR_CONNECT_TIMEOUT',
      'UND_ERR_HEADERS_TIMEOUT',
      'UND_ERR_BODY_TIMEOUT',
    ].some((code) => codes.has(code))
  )
    return 'The Trello request timed out. Check your network, VPN, or configured proxy, then retry.'
  if (
    [
      'SELF_SIGNED_CERT_IN_CHAIN',
      'DEPTH_ZERO_SELF_SIGNED_CERT',
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      'CERT_HAS_EXPIRED',
      'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    ].some((code) => codes.has(code))
  )
    return 'The local server could not verify the TLS certificate for Trello or its proxy. Ask your network administrator for the approved certificate setup; keep TLS verification enabled.'
  return 'Could not reach Trello. Check your network, VPN, or proxy. FLOWLENS_TRELLO_PROXY can override the installation proxy; restart Steerloom after changing it.'
}

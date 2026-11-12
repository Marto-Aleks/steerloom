import type { FlowBoardSnapshot } from '../../types'

export interface TrelloCard {
  id: string
  idShort: number
  idList: string
  closed: boolean
  shortUrl?: string
  name?: string
  /** Members on the card; the first one counts as its owner. */
  idMembers?: string[]
}
export interface TrelloList {
  id: string
  name: string
  pos?: number
}
export interface TrelloAction {
  id: string
  type: string
  date: string
  data: {
    card?: { id: string }
    list?: { id: string }
    listAfter?: { id: string }
    old?: { idList?: string }
  }
}
export interface TrelloBoardHistory {
  board: { id: string; name: string }
  lists: TrelloList[]
  cards: TrelloCard[]
  actions: TrelloAction[]
  /** Board members by id; absent in histories saved before owners were read. */
  members?: Array<{ id: string; name: string }>
}

// Only complete, observed card histories enter analytics. Never infer a list
// entry date from last activity or from the current position of a card.
export function normalizeTrelloBoard(
  payload: TrelloBoardHistory,
  loadedAt: string,
): FlowBoardSnapshot {
  const knownLists = new Set(payload.lists.map((list) => list.id))
  const memberName = new Map(
    (payload.members ?? []).map(({ id, name }) => [id, name]),
  )
  const issues: FlowBoardSnapshot['issues'] = []
  const transitions: FlowBoardSnapshot['transitions'] = []
  const actionsByCard = new Map<string, TrelloAction[]>()
  for (const action of payload.actions) {
    const cardId = action.data.card?.id
    if (!cardId || !Number.isFinite(Date.parse(action.date))) continue
    const actions = actionsByCard.get(cardId) ?? []
    actions.push(action)
    actionsByCard.set(cardId, actions)
  }
  let omitted = 0
  for (const card of payload.cards) {
    const events = (actionsByCard.get(card.id) ?? []).sort(
      (left, right) =>
        Date.parse(left.date) - Date.parse(right.date) ||
        left.id.localeCompare(right.id),
    )
    const creation = events.find(
      (action) => action.type === 'createCard' || action.type === 'copyCard',
    )
    const initialList = creation?.data.list?.id
    if (!creation || !initialList || !knownLists.has(initialList)) {
      omitted++
      continue
    }
    const history = [
      { issueId: card.id, statusId: initialList, enteredAt: creation.date },
    ]
    let valid = true
    for (const event of events) {
      if (event.type !== 'updateCard' || !event.data.old?.idList) continue
      const next = event.data.listAfter?.id
      if (
        !next ||
        !knownLists.has(next) ||
        history.at(-1)?.statusId !== event.data.old.idList
      ) {
        valid = false
        break
      }
      history.push({ issueId: card.id, statusId: next, enteredAt: event.date })
    }
    if (!valid || history.at(-1)?.statusId !== card.idList) {
      omitted++
      continue
    }
    issues.push({
      id: card.id,
      key: `CARD-${card.idShort}`,
      issueTypeId: 'card',
      issueTypeName: 'Card',
      createdAt: creation.date,
      archived: card.closed,
      browseUrl: card.shortUrl?.startsWith('https://trello.com/c/')
        ? card.shortUrl
        : undefined,
      ...(card.name?.trim() ? { title: card.name.trim().slice(0, 140) } : {}),
      ...cardOwner(card, payload.members ? memberName : null),
    })
    transitions.push(...history)
  }
  const lists = [...payload.lists].sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0))
  return {
    source: { kind: 'trello', label: payload.board.name },
    board: {
      ...payload.board,
      statuses: lists.map(({ id, name }) => ({ id, name })),
      columns: lists.map(({ id, name }) => ({ id, name, statusIds: [id] })),
    },
    issues,
    transitions,
    loadedAt,
    historyWarnings: omitted
      ? [
          `${omitted} cards were excluded because their creation or full list history could not be verified. Moved-in cards may have history on another board.`,
        ]
      : [],
  }
}

/** The first member on a card owns it; no member means nobody does. */
function cardOwner(
  card: TrelloCard,
  memberName: Map<string, string> | null,
): { assignee?: string; ownerKnown?: boolean } {
  if (!memberName || !card.idMembers) return {}
  const first = card.idMembers[0]
  if (!first) return { ownerKnown: true }
  return { assignee: memberName.get(first) ?? 'Unknown', ownerKnown: true }
}

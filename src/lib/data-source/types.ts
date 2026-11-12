import type { FlowBoardSnapshot, FlowSourceKind } from '../../types'

export interface BoardDataSource {
  readonly kind: FlowSourceKind
  loadBoard(boardId: string, signal?: AbortSignal): Promise<FlowBoardSnapshot>
}

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  AI_SKILL_IDS,
  isAiSkillId,
  type AiSkillId,
} from '../../../src/lib/ai/agent'

export { isAiSkillId }
export type { AiSkillId }

export interface AiSkillDefinition {
  id: AiSkillId
  name: string
  description: string
  instructions: string
}

const skillMetadata: Record<
  AiSkillId,
  Pick<AiSkillDefinition, 'name' | 'description'>
> = {
  'flow-diagnosis': {
    name: 'Flow diagnosis',
    description:
      'How delivery is going overall: where work is stuck, what changed between periods, the forecast, and what to decide next.',
  },
  'item-investigation': {
    name: 'Item investigation',
    description:
      'Specific items or a group of them: what they are about, why they are stuck, blockers and links, who holds them, what has gone quiet; also messages to their owners.',
  },
  'data-check': {
    name: 'Data check',
    description:
      'Whether a number can be trusted, how it is calculated, and whether a surprise is a data problem or a real process signal.',
  },
}

const skills = new Map<AiSkillId, AiSkillDefinition>(
  AI_SKILL_IDS.map((id) => {
    const metadata = skillMetadata[id]
    return [
      id,
      {
        id,
        ...metadata,
        instructions: skillBody(
          readFileSync(
            resolve(process.cwd(), 'server', 'ai', 'skills', id, 'SKILL.md'),
            'utf8',
          ),
        ),
      },
    ]
  }),
)

export function getAiSkill(id: AiSkillId): AiSkillDefinition {
  return skills.get(id) ?? skills.get('flow-diagnosis')!
}

export function listAiSkills(): AiSkillDefinition[] {
  return AI_SKILL_IDS.map((id) => getAiSkill(id))
}

function skillBody(source: string): string {
  const match = source.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]+)$/)
  return (match?.[1] ?? source).trim()
}

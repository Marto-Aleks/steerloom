import { describe, expect, it } from 'vitest'
import { AI_SKILL_IDS } from '../../../src/lib/ai/agent'
import { getAiSkill, listAiSkills } from './registry'

describe('Steerloom AI skill registry', () => {
  it('loads every versioned playbook without exposing its frontmatter', () => {
    const skills = listAiSkills()

    expect(skills.map(({ id }) => id)).toEqual(AI_SKILL_IDS)
    skills.forEach((skill) => {
      expect(skill.name.length).toBeGreaterThan(3)
      expect(skill.description.length).toBeGreaterThan(10)
      expect(skill.instructions.toLowerCase()).toContain(
        `# ${skill.name.toLowerCase()}`,
      )
      expect(skill.instructions).not.toContain('---')
      expect(skill.instructions).not.toContain('[TODO:')
    })
  })

  it('falls back to flow diagnosis if an internal caller supplies no match', () => {
    expect(getAiSkill('flow-diagnosis').id).toBe('flow-diagnosis')
  })
})

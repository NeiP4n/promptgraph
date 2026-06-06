import { describe, it, expect } from 'vitest'
import { Reranker } from '../src/reranker/reranker.js'

describe('Reranker', () => {
  it('has modelName and device properties with defaults', () => {
    const r = new Reranker()
    expect(r.modelName).toBe('default')
    expect(r.device).toBe('cpu')
  })

  it('accepts custom modelName and device', () => {
    const r = new Reranker('bge-reranker-v2', 'cuda')
    expect(r.modelName).toBe('bge-reranker-v2')
    expect(r.device).toBe('cuda')
  })

  it('returns empty array for empty results', async () => {
    const r = new Reranker()
    const out = await r.rerank('test query', [])
    expect(out).toEqual([])
  })

  it('returns empty array for null results', async () => {
    const r = new Reranker()
    const out = await r.rerank('test query', null)
    expect(out).toEqual([])
  })

  it('returns single result unchanged in order', async () => {
    const r = new Reranker()
    const results = [{ id: 'a', text: 'some text here', score: 0.8 }]
    const out = await r.rerank('test query', results)
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('a')
  })

  it('reranks preferring higher query term overlap', async () => {
    const r = new Reranker()
    const results = [
      { id: 'react', text: 'build user interfaces with components', score: 0.5 },
      { id: 'docker', text: 'docker containers deployment infrastructure', score: 0.5 },
    ]
    const out = await r.rerank('docker container deployment', results)
    expect(out[0].id).toBe('docker')
    expect(out[1].id).toBe('react')
  })

  it('returns top 5 when more than 5 given', async () => {
    const r = new Reranker()
    const results = Array.from({ length: 10 }, (_, i) => ({
      id: `skill-${i}`,
      text: 'common text here',
      score: 1 - i * 0.05,
    }))
    const out = await r.rerank('query', results)
    expect(out).toHaveLength(5)
  })

  it('term overlap boosts score for matching queries', async () => {
    const r = new Reranker()
    const results = [
      { id: 'match', text: 'exact match javascript coding', score: 0.4 },
      { id: 'no-match', text: 'completely unrelated topic', score: 0.5 },
    ]
    const out = await r.rerank('javascript match coding', results)
    expect(out[0].id).toBe('match')
    expect(out[0].score).toBeGreaterThan(out[1].score)
  })
})

export class Reranker {
  constructor(modelName = 'default', device = 'cpu') {
    this.modelName = modelName
    this.device = device
  }

  // Term-overlap boost on top of hybrid search scores.
  // Uses TF frequency (not just binary presence) and position-aware
  // boosts (title/header terms weighted higher).
  // Replace with BGE Reranker / MiniLM cross-encoder via ONNX for deeper semantic reranking.
  async rerank(query, results, topK = 5) {
    if (!results || results.length === 0) return []

    const queryTerms = (query.toLowerCase().match(/\w+/g) || []).slice(0, 50)
    const queryTermCount = queryTerms.length || 1

    const scored = results.map(r => {
      const text = (r.text || '').toLowerCase()
      const lines = text.split('\n')

      // TF frequency: count how many times each query term appears
      let totalFreq = 0
      for (const term of queryTerms) {
        let idx = -1
        let count = 0
        while ((idx = text.indexOf(term, idx + 1)) !== -1) count++
        totalFreq += count
      }
      const maxPossible = results.length * queryTermCount
      const tfScore = Math.min(totalFreq / Math.max(queryTermCount, 1) / 5, 1)

      // Position boost: terms in first 3 lines (title/headers) count extra
      const headerText = lines.slice(0, 3).join(' ').toLowerCase()
      const headerOverlap = queryTerms.filter(t => headerText.includes(t)).length / queryTermCount

      // Binary overlap (original signal)
      const binOverlap = queryTerms.filter(t => text.includes(t)).length / queryTermCount

      const overlapScore = 0.4 * binOverlap + 0.4 * tfScore + 0.2 * headerOverlap

      return {
        ...r,
        score: 0.75 * (r.score || 0) + 0.25 * overlapScore,
      }
    })

    return scored.sort((a, b) => b.score - a.score).slice(0, topK)
  }
}

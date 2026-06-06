export class Reranker {
  constructor(modelName = 'default', device = 'cpu') {
    this.modelName = modelName
    this.device = device
  }

  // Cross-encoder style reranker
  // Plug-in point for BGE Reranker / MiniLM Reranker via ONNX
  async rerank(query, results) {
    if (!results || results.length === 0) return []

    const queryTerms = (query.toLowerCase().match(/\w+/g) || [])
    const queryTermCount = queryTerms.length || 1

    const scored = results.map(r => {
      const text = (r.text || '').toLowerCase()
      const termOverlap = queryTerms.filter(t => text.includes(t)).length / queryTermCount

      return {
        ...r,
        score: 0.8 * (r.score || 0) + 0.2 * termOverlap,
      }
    })

    return scored.sort((a, b) => b.score - a.score).slice(0, 5)
  }
}

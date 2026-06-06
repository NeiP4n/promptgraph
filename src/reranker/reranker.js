export class Reranker {
  constructor(modelName = 'default', device = 'cpu') {
    this.modelName = modelName
    this.device = device
  }

  // Term-overlap boost on top of hybrid search scores
  // This is a lightweight reranker that ranks by term overlap ratio.
  // Replace with BGE Reranker / MiniLM cross-encoder via ONNX for deeper semantic reranking.
  async rerank(query, results) {
    if (!results || results.length === 0) return []

    const queryTerms = (query.toLowerCase().match(/\w+/g) || []).slice(0, 50)
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

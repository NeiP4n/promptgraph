// Term-overlap reranker with phrase matching and IDF-like weighting.
// Replace `rerank()` with a cross-encoder (BGE Reranker / MiniLM via ONNX)
// for deeper semantic reranking. This class is the plug-in point.
export class Reranker {
  constructor(modelName = 'default', device = 'cpu') {
    this.modelName = modelName
    this.device = device
  }

  rerank(query, results, topK = 5) {
    if (!results || results.length === 0) return []

    const rawTerms = (query.toLowerCase().match(/\w+/g) || [])
    if (rawTerms.length === 0) return results.slice(0, topK)

    const unigrams = rawTerms
    const bigrams = []
    const trigrams = []
    for (let i = 0; i < rawTerms.length - 1; i++) bigrams.push(rawTerms[i] + ' ' + rawTerms[i + 1])
    for (let i = 0; i < rawTerms.length - 2; i++) trigrams.push(rawTerms[i] + ' ' + rawTerms[i + 1] + ' ' + rawTerms[i + 2])

    const texts = results.map(r => (r.text || '').toLowerCase())

    // Term doc-frequency
    const termDf = {}
    for (const t of unigrams) {
      termDf[t] = texts.filter(txt => txt.includes(t)).length
    }
    const nResults = results.length

    // First pass: compute raw tfIdf for each result
    const tfIdfValues = texts.map(text => {
      let sum = 0
      for (const term of unigrams) {
        const df = termDf[term] || 1
        const idf = 1 + Math.log10((nResults + 1) / df)
        let idx = -1
        let count = 0
        while ((idx = text.indexOf(term, idx + 1)) !== -1) count++
        sum += count * idf
      }
      return sum
    })

    const maxTfIdf = Math.max(...tfIdfValues, 1)

    const scored = results.map((r, idx) => {
      const text = texts[idx]
      const lines = text.split('\n')

      // 1. N-gram overlap
      const unigramMatch = unigrams.filter(t => text.includes(t)).length / unigrams.length
      const bigramMatch = bigrams.length > 0 ? bigrams.filter(b => text.includes(b)).length / bigrams.length : 0
      const trigramMatch = trigrams.length > 0 ? trigrams.filter(t => text.includes(t)).length / trigrams.length : 0
      const ngramScore = 0.4 * unigramMatch + 0.35 * bigramMatch + 0.25 * trigramMatch

      // 2. IDF-weighted TF (normalised by max across results)
      const tfIdfScore = tfIdfValues[idx] / maxTfIdf

      // 3. Exact phrase proximity — consecutive same-order term matches
      let phraseBoost = 0
      if (rawTerms.length >= 2) {
        const textWords = text.split(/\s+/)
        let bestRun = 0
        for (let i = 0; i < textWords.length - rawTerms.length + 1; i++) {
          let matchLen = 0
          for (let j = 0; j < rawTerms.length; j++) {
            if (textWords[i + j] === rawTerms[j]) matchLen++
            else break
          }
          if (matchLen >= 2) bestRun = Math.max(bestRun, matchLen)
        }
        phraseBoost = bestRun / rawTerms.length
      }

      // 4. Header position boost
      const headerText = lines.slice(0, 3).join(' ').toLowerCase()
      const headerOverlap = unigrams.filter(t => headerText.includes(t)).length / unigrams.length

      // Blend
      const overlapScore = 0.25 * ngramScore + 0.25 * tfIdfScore + 0.25 * phraseBoost + 0.15 * headerOverlap + 0.10 * unigramMatch

      return {
        id: r.id,
        text: r.text,
        score: 0.70 * (r.score || 0) + 0.30 * overlapScore,
      }
    })

    return scored.sort((a, b) => b.score - a.score).slice(0, topK)
  }
}

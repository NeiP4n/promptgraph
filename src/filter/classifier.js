import { cosineSimilarity } from '../../embedder.js';

const SKILL_THRESHOLD = 0.35;
const UNSURE_THRESHOLD = 0.15;

const DOC_FIRST_HEADERS = /^(overview|introduction|about|background|welcome|getting started|what is|why |table of contents|toc|foreword|preface|readme)/i;
const INSTRUCTION_HEADERS = /^#{1,3}\s+(steps?|usage|instructions?|how\s+to|when\s+to\s+use|workflow|process|procedure|example|examples?|commands?|output|result)/i;
const IMPERATIVE_HEADERS = /\b(run|use|apply|execute|check|debug|fix|create|add|remove|deploy|test|write|generate|analyze|review|refactor|optimize|configure|setup|install|scan|audit|validate|search|find|extract|parse)\b/i;

export function getFeatureVector(raw) {
  const lines = raw.split('\n');
  const nonEmpty = lines.filter(l => l.trim());
  const headers = nonEmpty.filter(l => /^#{1,3}\s/.test(l));
  const paragraphs = raw.split(/\n\n+/).filter(p => p.trim() && !p.trim().startsWith('#'));
  const words = raw.toLowerCase().split(/\s+/).filter(w => w.length > 3);

  const firstHeader = headers[0]?.replace(/^#+\s*/, '') || '';
  const longProse = paragraphs.filter(p => p.split(' ').length > 60 && !/```/.test(p));
  const wordRatio = words.length > 80 ? new Set(words).size / words.length : 1;

  return [
    Number(raw.length >= 150),
    Number(headers.length >= 1),
    Number(lines.some(l => INSTRUCTION_HEADERS.test(l))),
    Number(headers.some(h => IMPERATIVE_HEADERS.test(h))),
    Number(raw.includes('```') || raw.includes('    ')),
    Number(nonEmpty.some(l => /^\d+\.\s/.test(l))),
    Number(nonEmpty.some(l => /^[-*+]\s/.test(l))),
    Number(headers.length >= 2),
    Number(headers.length >= 4),
    Number(DOC_FIRST_HEADERS.test(firstHeader)) ? 1 : 0,
    Number(longProse.length > paragraphs.length * 0.6 && paragraphs.length > 3) ? 1 : 0,
    Number(wordRatio >= 0.22) ? 0 : 1,
    Number(raw.length < 150) ? 1 : 0,
    Number(headers.length < 1) ? 1 : 0,
  ];
}

export function classify(rawVec, centroids) {
  if (!centroids) {
    return { label: 'skill', score: 1, method: 'fallback' };
  }

  const goodSim = centroids.good ? cosineSimilarity(rawVec, centroids.good) : 0;
  const badSim = centroids.bad ? cosineSimilarity(rawVec, centroids.bad) : 0;

  const rawScore = goodSim - badSim;
  const score = (rawScore + 1) / 2;

  if (score >= SKILL_THRESHOLD) {
    return { label: 'skill', score, goodSim, badSim, method: 'centroid' };
  }
  if (score >= UNSURE_THRESHOLD) {
    return { label: 'unsure', score, goodSim, badSim, method: 'centroid' };
  }
  return { label: 'reject', score, goodSim, badSim, method: 'centroid' };
}

export { SKILL_THRESHOLD, UNSURE_THRESHOLD };

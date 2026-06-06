#!/usr/bin/env node
import { performance } from 'perf_hooks'

const QUERIES = [
  'deploy kubernetes',
  'refactor react component',
  'debug database connection',
  'write api endpoint',
  'configure ci cd pipeline',
  'lint python code',
  'optimize docker image',
  'test nodejs application',
  'analyze bundle size',
  'setup monitoring dashboard',
]

async function main() {
  const search = (await import('../search.js')).search

  console.log('Warming up ONNX model...')
  await search('warmup', 1)

  console.log(`\nRunning ${QUERIES.length} search queries...`)
  const times = []

  for (const q of QUERIES) {
    const start = performance.now()
    const results = await search(q, 5)
    const elapsed = performance.now() - start

    times.push(elapsed)
    const pct = results.length > 0 ? ` (top: ${(results[0].score * 100).toFixed(0)}%)` : ' (no results)'
    console.log(`  ${elapsed.toFixed(0)}ms  "${q}"${pct}`)
  }

  times.sort((a, b) => a - b)
  const avg = times.reduce((a, b) => a + b, 0) / times.length
  const p50 = times[Math.floor(times.length * 0.5)]
  const p95 = times[Math.floor(times.length * 0.95)]

  console.log(`\nSearch Latency (ms):`)
  console.log(`  Average: ${avg.toFixed(0)}`)
  console.log(`  P50:     ${p50.toFixed(0)}`)
  console.log(`  P95:     ${p95.toFixed(0)}`)
  console.log(`  Min:     ${times[0].toFixed(0)}`)
  console.log(`  Max:     ${times[times.length - 1].toFixed(0)}`)
}

main().catch(e => { console.error(e); process.exit(1) })

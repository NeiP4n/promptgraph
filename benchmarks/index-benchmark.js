#!/usr/bin/env node
import { performance } from 'perf_hooks'
import fs from 'fs'
import path from 'path'
import os from 'os'

async function main() {
  const { indexAll } = await import('../indexer.js')

  // Print system info
  const dbPath = path.join(os.homedir(), '.claude', '.promptgraph', 'promptgraph.db')
  const dbSize = fs.existsSync(dbPath) ? (fs.statSync(dbPath).size / 1024).toFixed(0) : 'N/A'
  const memMb = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(0)

  console.log(`System:`)
  console.log(`  CPU:      ${os.cpus()[0].model}`)
  console.log(`  RAM:      ${(os.totalmem() / 1024 / 1024 / 1024).toFixed(1)} GB`)
  console.log(`  DB size:  ${dbSize} KB`)
  console.log(`  Heap:     ${memMb} MB\n`)

  // Measure full reindex
  console.log('Measuring full reindex...')
  const reindexStart = performance.now()
  await indexAll({ fast: false })
  const reindexTime = (performance.now() - reindexStart) / 1000

  console.log(`  Full reindex: ${reindexTime.toFixed(1)}s`)

  // Measure fast reindex (keyword-only)
  console.log('\nMeasuring fast reindex (keyword-only)...')
  const fastStart = performance.now()
  await indexAll({ fast: true })
  const fastTime = (performance.now() - fastStart) / 1000

  console.log(`  Fast reindex: ${fastTime.toFixed(1)}s`)

  // Post-benchmark DB size
  const dbSizeAfter = fs.existsSync(dbPath) ? (fs.statSync(dbPath).size / 1024).toFixed(0) : 'N/A'
  console.log(`\n  DB size after: ${dbSizeAfter} KB`)
}

main().catch(e => { console.error(e); process.exit(1) })

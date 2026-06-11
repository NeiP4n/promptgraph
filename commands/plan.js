import { success, error, info } from '../cli.js';
import chalk from 'chalk';

// pg plan <skill>  — show the DAG execution plan for a goal skill.
export default async function handler(args, bin) {
  const target = args.slice(1).filter(a => !a.startsWith('-')).join(' ');
  if (!target) { error('Usage: pg plan <skill-id-or-name>'); process.exit(1); }
  const asJson = args.includes('--json');

  const { buildPlan } = await import('../planner.js');
  const plan = buildPlan(target);
  if (plan?.error) { error(plan.error); process.exit(1); }

  if (asJson) { console.log(JSON.stringify(plan, null, 2)); process.exit(0); }

  const name = (id) => plan.nodes[id]?.name || id;

  console.log('\n' + chalk.bold(`Plan for ${chalk.cyan(plan.root.name)}`) +
    chalk.gray(`  (${plan.count} skill${plan.count === 1 ? '' : 's'})`));

  if (!plan.acyclic) {
    console.log(chalk.red(`\n  ✗ Cycle detected — cannot execute as-is:`));
    for (const cyc of plan.cycles) {
      console.log('    ' + chalk.red(cyc.map(name).join(' → ')));
    }
    console.log(chalk.gray('    Break the cycle (a skill ends up depending on itself).'));
  }

  if (plan.unresolved.length) {
    console.log(chalk.yellow(`\n  ⚠ Referenced but not indexed (${plan.unresolved.length}):`));
    for (const u of plan.unresolved) console.log('    ' + chalk.yellow(u));
  }

  if (plan.acyclic && plan.levels.length) {
    console.log(chalk.bold('\n  Execution order ') + chalk.gray('(dependencies first; each level can run in parallel):'));
    plan.levels.forEach((batch, i) => {
      const tag = batch.length > 1 ? chalk.gray(` (${batch.length} parallel)`) : '';
      console.log(`    ${chalk.gray(`L${i}`)}  ${batch.map(id => chalk.white(name(id))).join(chalk.gray(' · '))}${tag}`);
    });
    console.log(chalk.gray('\n  Linear order: ') + plan.order.map(name).join(chalk.gray(' → ')));
  }

  console.log();
  process.exit(0);
}

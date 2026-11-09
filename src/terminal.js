import { humanBytes } from './analyze.js';

const useColor = (() => {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  return Boolean(process.stdout.isTTY) && process.env.TERM !== 'dumb';
})();

const paint = (code) => (s) => useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s);
const c = {
  bold: paint('1'), dim: paint('2'), red: paint('31'), green: paint('32'),
  yellow: paint('33'), blue: paint('34'), magenta: paint('35'), cyan: paint('36'),
  gray: paint('90'), white: paint('37'),
};

const num = (n) => (n || 0).toLocaleString('en-US');
const bar = (pct, width = 18) => {
  const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
};
const spark = (values) => {
  if (!values.length) return '';
  const ticks = '▁▂▃▄▅▆▇█';
  const max = Math.max(...values, 1);
  return values.map((v) => ticks[Math.min(7, Math.floor((v / max) * 7))]).join('');
};
const gradeColor = (g) => (g.startsWith('A') ? c.green : g === 'B' ? c.cyan : g === 'C' ? c.yellow : c.red);
const riskColor = (r) => (r >= 66 ? c.red : r >= 33 ? c.yellow : c.green);

export function printSummary(d, outPath) {
  const { meta, health, contributors, activity, velocity, hotspots, languages } = d;
  const L = [];
  L.push('');
  L.push(`  ${c.bold(c.cyan('GitVitals'))}  ${c.dim('·')}  ${c.bold(meta.name)}  ${c.dim(`(${meta.branch})`)}`);
  L.push('');

  // Health
  const gc = gradeColor(health.grade);
  L.push(`  ${c.dim('Health')}   ${gc(c.bold(health.grade))}  ${c.bold(num(health.score))}${c.dim('/100')}  ${gc(health.label)}`);
  L.push(`  ${gc(bar(health.score, 28))}`);
  for (const f of health.factors) {
    L.push(`    ${c.dim(f.label.padEnd(18))} ${bar(f.score, 12)} ${c.dim(f.detail)}`);
  }
  L.push('');

  // KPIs
  L.push(`  ${c.bold(num(meta.totalCommits))} ${c.dim('commits')}   ${c.bold(num(meta.totalContributors))} ${c.dim('contributors')}   ${c.bold(num(meta.totalFiles))} ${c.dim('files')}   ${c.bold(humanBytes(meta.totalBytes))}`);
  const bfColor = contributors.busFactor <= 1 ? c.red : contributors.busFactor === 2 ? c.yellow : c.green;
  L.push(`  ${c.dim('Bus factor')} ${bfColor(c.bold(String(contributors.busFactor)))} ${c.dim(`(${contributors.busFactorLabel})`)}   ${c.dim('Top author')} ${c.bold(contributors.topSharePercent + '%')}   ${c.dim('Age')} ${c.bold(num(meta.ageDays) + 'd')}`);
  L.push('');

  // Activity sparkline (monthly commits)
  const months = velocity.series.slice(-18).map((s) => s.commits);
  L.push(`  ${c.dim('Velocity')}  ${c.cyan(spark(months))}  ${c.dim(`trend ${velocity.trend >= 0 ? '+' : ''}${velocity.trend}%`)}`);
  L.push(`  ${c.dim('Active days')} ${c.bold(num(activity.activeDays))}   ${c.dim('Longest streak')} ${c.bold(num(activity.longestStreak) + 'd')}   ${c.dim('Current')} ${c.bold(num(activity.currentStreak) + 'd')}`);
  L.push('');

  // Contributors
  if (contributors.list.length) {
    L.push(`  ${c.bold('Top contributors')}`);
    const top = contributors.list.slice(0, 5);
    const maxName = Math.max(...top.map((t) => t.name.length), 6);
    top.forEach((t, i) => {
      L.push(`   ${c.dim(String(i + 1) + '.')} ${t.name.padEnd(maxName)} ${c.cyan(bar(t.percent, 14))} ${c.bold(num(t.commits))} ${c.dim(t.percent + '%')}`);
    });
    L.push('');
  }

  // Hotspots
  if (hotspots.length) {
    L.push(`  ${c.bold('Hotspots')} ${c.dim('(churn × size — likely refactor / bug risks)')}`);
    hotspots.slice(0, 5).forEach((h) => {
      const p = h.path.length > 40 ? '…' + h.path.slice(-39) : h.path;
      L.push(`   ${riskColor(h.risk)('●')} ${p.padEnd(41)} ${c.bold(num(h.changes))} ${c.dim('changes')}  ${riskColor(h.risk)(bar(h.risk, 8))} ${c.dim('risk ' + h.risk)}`);
    });
    L.push('');
  }

  // Languages
  if (languages.length) {
    L.push(`  ${c.bold('Languages')}`);
    languages.slice(0, 6).forEach((l) => {
      L.push(`   ${l.name.padEnd(14)} ${c.magenta(bar(l.percent, 14))} ${c.dim(l.percent + '%')}  ${c.dim(humanBytes(l.bytes))}`);
    });
    L.push('');
  }

  L.push(`  ${c.green('✔')} ${c.dim('Report:')} ${c.bold(outPath)}`);
  L.push(`  ${c.dim('Open it in a browser — one self-contained file, 100% offline.')}`);
  L.push('');
  process.stdout.write(L.join('\n') + '\n');
}
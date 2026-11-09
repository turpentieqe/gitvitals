// Generates a realistic demo Git repository (.demo-repo) so GitVitals has
// something beautiful to analyze. Deterministic via a seeded PRNG.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const repo = join(root, 'demo-app');

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261109);
const ri = (min, max) => Math.floor(rnd() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
function weighted(items) {
  const total = items.reduce((s, i) => s + i[1], 0);
  let r = rnd() * total;
  for (const [val, w] of items) { if ((r -= w) <= 0) return val; }
  return items[items.length - 1][0];
}

const authors = [
  [{ name: 'Alice Nguyen', email: 'alice@example.com' }, 40],
  [{ name: 'Bob Martinez', email: 'bob@example.com' }, 24],
  [{ name: 'Carol Smith', email: 'carol@example.com' }, 15],
  [{ name: 'Dave Kim', email: 'dave@example.com' }, 10],
  [{ name: 'Erin Johnson', email: 'erin@example.com' }, 7],
  [{ name: 'Frank Weber', email: 'frank@example.com' }, 4],
];

// path, selection weight (hotspots higher), base size in lines
const filePool = [
  ['src/app.tsx', 14, 120], ['src/index.ts', 12, 80], ['server/main.py', 11, 90],
  ['src/utils.js', 10, 60], ['src/components/Dashboard.tsx', 7, 140],
  ['src/components/Chart.tsx', 6, 110], ['src/api/client.ts', 6, 70],
  ['server/models.py', 5, 100], ['server/utils.py', 4, 50], ['cmd/root.go', 4, 80],
  ['styles/main.css', 4, 90], ['styles/theme.scss', 3, 70], ['public/index.html', 3, 40],
  ['tests/app.test.ts', 5, 60], ['tests/utils.test.js', 3, 40], ['src/hooks/useData.ts', 4, 55],
  ['docs/guide.md', 3, 60], ['README.md', 3, 50], ['scripts/deploy.sh', 2, 30],
  ['data/schema.sql', 2, 45], ['package.json', 2, 30], ['tsconfig.json', 1, 20],
  ['.github/workflows/ci.yml', 2, 35], ['Dockerfile', 1, 18], ['Makefile', 1, 22],
  ['assets/logo.svg', 1, 12], ['src/types.ts', 3, 40], ['server/config.py', 2, 30],
];
const fileWeights = filePool.map(([p, w]) => [p, w]);

function git(args, env) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env, ...env }, windowsHide: true });
}

function contentFor(path, lines) {
  const ext = path.split('.').pop();
  const comment = { py: '#', sh: '#', yml: '#', sql: '--', go: '//', ts: '//', tsx: '//', js: '//', css: '/*', scss: '//', md: '', json: '', html: '<!--' }[ext] ?? '//';
  const out = [`${comment} ${path} — part of the GitVitals demo project`.trim()];
  for (let i = 0; i < lines; i++) {
    out.push(`${comment} line ${i + 1}: lorem ipsum dolor sit amet consectetur adipiscing elit`.trim() || `line ${i + 1}`);
  }
  if (ext === 'json') return JSON.stringify({ name: 'demo', version: '1.0.0', private: true, padding: out }, null, 2) + '\n';
  return out.join('\n') + '\n';
}

// Fresh repo
if (existsSync(repo)) rmSync(repo, { recursive: true, force: true });
mkdirSync(repo, { recursive: true });
git(['init', '-b', 'main']);
git(['config', 'user.email', 'demo@gitvitals.dev']);
git(['config', 'user.name', 'GitVitals Demo']);
git(['config', 'commit.gpgsign', 'false']);

const DAY = 86400;
const now = Math.floor(Date.now() / 1000);
const todayUtc = Math.floor(now / DAY) * DAY;
const startTs = todayUtc - 420 * DAY;

// Initial commit creates every file.
for (const [path, , lines] of filePool) {
  const full = join(repo, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, contentFor(path, lines));
}
const initDate = `${startTs} +0000`;
git(['add', '-A']);
git(['commit', '-m', 'Initial commit: project scaffolding', '--author=Alice Nguyen <alice@example.com>'],
  { GIT_AUTHOR_DATE: initDate, GIT_COMMITTER_DATE: initDate });

let commitCount = 1;
const verbs = ['Fix', 'Add', 'Refactor', 'Update', 'Improve', 'Optimize', 'Clean up', 'Handle', 'Support'];
const nouns = ['edge case in parser', 'dashboard layout', 'API retry logic', 'type definitions', 'cache invalidation', 'error handling', 'test coverage', 'build pipeline', 'hotspot module', 'data fetching'];

for (let ts = startTs + DAY; ts <= todayUtc; ts += DAY) {
  const dow = (new Date(ts * 1000).getUTCDay() + 6) % 7; // Mon=0
  const isWeekend = dow >= 5;
  let n = isWeekend ? ri(0, 1) : ri(0, 3);
  if (ts === todayUtc) n = Math.max(n, ri(1, 2)); // ensure recent activity
  for (let k = 0; k < n; k++) {
    const hour = weighted([[9, 3], [10, 5], [11, 5], [12, 2], [13, 3], [14, 5], [15, 5], [16, 4], [17, 3], [18, 2], [20, 1], [22, 1]]);
    const commitTs = ts + hour * 3600 + ri(0, 3599);
    const author = weighted(authors);
    const touched = new Set();
    const fc = ri(1, 4);
    for (let f = 0; f < fc; f++) touched.add(weighted(fileWeights));
    for (const path of touched) {
      const full = join(repo, path);
      appendFileSync(full, `// change ${commitCount} by ${author.name}\n`);
    }
    const date = `${commitTs} +0000`;
    git(['add', '-A']);
    git(['commit', '-m', `${pick(verbs)} ${pick(nouns)}`, `--author=${author.name} <${author.email}>`],
      { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
    commitCount++;
  }
}

process.stdout.write(`Demo repo created: ${repo}\nCommits: ${commitCount}\nFiles: ${filePool.length}\n`);
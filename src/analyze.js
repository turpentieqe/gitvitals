import { detectLanguage } from './languages.js';

const DAY = 86400;
const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const round1 = (n) => Math.round(n * 10) / 10;

export function humanBytes(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

const dayKey = (ts) => new Date(ts * 1000).toISOString().slice(0, 10);
const monthKey = (ts) => new Date(ts * 1000).toISOString().slice(0, 7);
const iso = (ts) => new Date(ts * 1000).toISOString();
const dowMon0 = (ts) => (new Date(ts * 1000).getUTCDay() + 6) % 7; // Mon=0..Sun=6

export function analyze(commits, files, repoMeta) {
  const now = Math.floor(Date.now() / 1000);
  const totalBytes = files.reduce((s, f) => s + f.bytes, 0);

  const contributors = computeContributors(commits);
  const activity = computeActivity(commits, now);
  const velocity = computeVelocity(commits, now);
  const hotspots = computeHotspots(commits, files);
  const languages = computeLanguages(files, totalBytes);

  const firstTime = commits.length ? commits[0].time : null;
  const lastTime = commits.length ? commits[commits.length - 1].time : null;
  const spanDays = firstTime != null ? Math.max(0, Math.round((lastTime - firstTime) / DAY)) : 0;
  const ageDays = firstTime != null ? Math.max(0, Math.round((now - firstTime) / DAY)) : 0;

  const meta = {
    name: repoMeta.name,
    branch: repoMeta.branch,
    generatedAt: iso(now),
    totalCommits: commits.length,
    totalContributors: contributors.total,
    totalFiles: files.length,
    totalBytes,
    firstCommit: firstTime != null ? iso(firstTime) : null,
    lastCommit: lastTime != null ? iso(lastTime) : null,
    ageDays,
    spanDays,
  };

  const health = computeHealth({ commits, contributors, activity, hotspots, meta, now });

  const treemap = files
    .filter((f) => f.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 400)
    .map((f) => ({ path: f.path, bytes: f.bytes, lang: f.lang, color: f.color }));

  const biggestFiles = files
    .filter((f) => f.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 10)
    .map((f) => ({ path: f.path, bytes: f.bytes, lang: f.lang, color: f.color }));

  return { meta, health, activity, velocity, contributors, hotspots, languages, treemap, biggestFiles };
}

function computeContributors(commits) {
  const groups = new Map();
  for (const c of commits) {
    const key = c.email || `name:${c.author}`;
    let g = groups.get(key);
    if (!g) {
      g = { names: new Map(), commits: 0, additions: 0, deletions: 0, first: c.time, last: c.time, days: new Set() };
      groups.set(key, g);
    }
    g.names.set(c.author, (g.names.get(c.author) || 0) + 1);
    g.commits++;
    g.additions += c.additions;
    g.deletions += c.deletions;
    g.first = Math.min(g.first, c.time);
    g.last = Math.max(g.last, c.time);
    g.days.add(dayKey(c.time));
  }

  const total = commits.length;
  const all = [...groups.values()].map((g) => {
    const name = [...g.names.entries()].sort((a, b) => b[1] - a[1])[0][0];
    return {
      name,
      commits: g.commits,
      percent: total ? round1((g.commits / total) * 100) : 0,
      additions: g.additions,
      deletions: g.deletions,
      firstCommit: iso(g.first),
      lastCommit: iso(g.last),
      activeDays: g.days.size,
    };
  }).sort((a, b) => b.commits - a.commits);

  // Bus factor: fewest top contributors covering >= 50% of commits.
  let cum = 0, busFactor = 0;
  const half = total * 0.5;
  for (const c of all) {
    cum += c.commits; busFactor++;
    if (cum >= half) break;
  }
  const busFactorLabel = total === 0 ? 'No data'
    : busFactor <= 1 ? 'Critical'
    : busFactor === 2 ? 'Fragile'
    : busFactor <= 4 ? 'Moderate'
    : 'Healthy';

  return {
    total: all.length,
    busFactor,
    busFactorLabel,
    topSharePercent: all.length ? all[0].percent : 0,
    list: all.slice(0, 25),
  };
}

function computeActivity(commits, now) {
  const byDay = new Map();
  const byHour = new Array(24).fill(0);
  const byDow = new Array(7).fill(0);
  const punch = new Map();

  for (const c of commits) {
    const dk = dayKey(c.time);
    byDay.set(dk, (byDay.get(dk) || 0) + 1);
    const h = new Date(c.time * 1000).getUTCHours();
    const d = dowMon0(c.time);
    byHour[h]++;
    byDow[d]++;
    const pk = `${d}:${h}`;
    punch.set(pk, (punch.get(pk) || 0) + 1);
  }

  // GitHub-style calendar: 53 weeks ending today (UTC), Monday-first.
  const endTs = Math.floor(now / DAY) * DAY;
  const endDow = dowMon0(endTs);
  const startTs = endTs - (52 * 7 + endDow) * DAY;
  const calendar = [];
  let maxDay = 0;
  for (let ts = startTs; ts <= endTs; ts += DAY) {
    const dk = dayKey(ts);
    const count = byDay.get(dk) || 0;
    calendar.push({ date: dk, count });
    if (count > maxDay) maxDay = count;
  }

  const punchcard = [...punch.entries()].map(([k, count]) => {
    const [d, h] = k.split(':').map(Number);
    return { dow: d, hour: h, count };
  });
  const punchMax = punchcard.reduce((m, p) => Math.max(m, p.count), 0);

  // Streaks over all-time active days.
  const dayTs = [...byDay.keys()].map((k) => Math.floor(new Date(`${k}T00:00:00Z`).getTime() / 1000)).sort((a, b) => a - b);
  let longestStreak = 0, run = 0, prev = null;
  for (const ts of dayTs) {
    run = prev != null && ts - prev === DAY ? run + 1 : 1;
    longestStreak = Math.max(longestStreak, run);
    prev = ts;
  }
  let currentStreak = 0;
  if (dayTs.length) {
    const last = dayTs[dayTs.length - 1];
    if (last === endTs || last === endTs - DAY) {
      currentStreak = 1;
      for (let i = dayTs.length - 2; i >= 0; i--) {
        if (dayTs[i + 1] - dayTs[i] === DAY) currentStreak++;
        else break;
      }
    }
  }

  const activeDays = byDay.size;
  return {
    calendar,
    calendarStart: dayKey(startTs),
    calendarEnd: dayKey(endTs),
    maxDay,
    byHour,
    byDow,
    punchcard,
    punchMax,
    activeDays,
    currentStreak,
    longestStreak,
    avgPerActiveDay: activeDays ? round1(commits.length / activeDays) : 0,
  };
}

function computeVelocity(commits, now) {
  if (!commits.length) {
    return { series: [], trend: 0, peak: { label: '', commits: 0 } };
  }
  const byMonth = new Map();
  for (const c of commits) {
    const mk = monthKey(c.time);
    const e = byMonth.get(mk) || { commits: 0, additions: 0, deletions: 0 };
    e.commits++; e.additions += c.additions; e.deletions += c.deletions;
    byMonth.set(mk, e);
  }

  const first = new Date(commits[0].time * 1000);
  const last = new Date(commits[commits.length - 1].time * 1000);
  let cur = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1) / 1000;
  const endM = Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), 1) / 1000;
  const series = [];
  let guard = 0;
  while (cur <= endM && guard < 1200) {
    const label = new Date(cur * 1000).toISOString().slice(0, 7);
    const e = byMonth.get(label) || { commits: 0, additions: 0, deletions: 0 };
    series.push({ label, commits: e.commits, additions: e.additions, deletions: e.deletions });
    const d = new Date(cur * 1000);
    cur = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000;
    guard++;
  }

  const peak = series.reduce((m, s) => (s.commits > m.commits ? s : m), { label: '', commits: 0 });

  const d30 = now - 30 * DAY, d60 = now - 60 * DAY;
  let recent = 0, prevPeriod = 0;
  for (const c of commits) {
    if (c.time >= d30) recent++;
    else if (c.time >= d60) prevPeriod++;
  }
  const trend = prevPeriod > 0 ? Math.round(((recent - prevPeriod) / prevPeriod) * 100) : (recent > 0 ? 100 : 0);

  return { series, trend, peak: { label: peak.label, commits: peak.commits } };
}

function computeHotspots(commits, files) {
  const tracked = new Map(files.map((f) => [f.path, f]));
  const hs = new Map();
  for (const c of commits) {
    for (const f of c.files) {
      if (!tracked.has(f.path)) continue;
      let e = hs.get(f.path);
      if (!e) {
        e = { changes: 0, authors: new Set(), lastChange: 0 };
        hs.set(f.path, e);
      }
      e.changes++;
      e.authors.add(c.email || c.author);
      e.lastChange = Math.max(e.lastChange, c.time);
    }
  }
  const maxChanges = [...hs.values()].reduce((m, e) => Math.max(m, e.changes), 0) || 1;

  const rows = [];
  for (const [path, e] of hs) {
    const tf = tracked.get(path);
    const bytes = tf ? tf.bytes : 0;
    const det = tf ? { lang: tf.lang, color: tf.color } : detectLanguage(path);
    const churnNorm = e.changes / maxChanges;
    const sizeNorm = Math.min(1, Math.log10(bytes + 1) / 6);
    const risk = Math.round(100 * (0.7 * churnNorm + 0.3 * sizeNorm));
    rows.push({
      path, changes: e.changes, authors: e.authors.size, bytes,
      lang: det.lang || det.name, color: det.color, risk,
      lastChange: iso(e.lastChange),
    });
  }
  rows.sort((a, b) => b.risk - a.risk || b.changes - a.changes);
  return rows.slice(0, 20);
}

function computeLanguages(files, totalBytes) {
  const map = new Map();
  for (const f of files) {
    const e = map.get(f.lang) || { name: f.lang, color: f.color, bytes: 0, files: 0 };
    e.bytes += f.bytes; e.files++;
    map.set(f.lang, e);
  }
  let arr = [...map.values()].sort((a, b) => b.bytes - a.bytes);
  for (const e of arr) e.percent = totalBytes ? round1((e.bytes / totalBytes) * 100) : 0;

  if (arr.length > 12) {
    const top = arr.slice(0, 12);
    const rest = arr.slice(12);
    const bytes = rest.reduce((s, e) => s + e.bytes, 0);
    const count = rest.reduce((s, e) => s + e.files, 0);
    top.push({
      name: 'Other', color: '#6e7681', bytes, files: count,
      percent: totalBytes ? round1((bytes / totalBytes) * 100) : 0,
    });
    arr = top;
  }
  return arr;
}

function computeHealth({ commits, contributors, activity, hotspots, meta, now }) {
  const daysSinceLast = meta.lastCommit ? Math.floor((now - new Date(meta.lastCommit).getTime() / 1000) / DAY) : null;

  // Recency
  const recency = daysSinceLast == null ? 0
    : daysSinceLast <= 7 ? 100
    : daysSinceLast <= 30 ? 85
    : daysSinceLast <= 90 ? 65
    : daysSinceLast <= 180 ? 45
    : daysSinceLast <= 365 ? 25 : 10;

  // Bus factor / knowledge distribution
  const bf = contributors.busFactor;
  const busScore = contributors.total === 0 ? 0
    : bf <= 1 ? 25 : bf === 2 ? 50 : bf === 3 ? 70 : bf === 4 ? 85 : 100;

  // Consistency: fraction of weeks with activity over the repo's lifespan.
  let consistency = 0, weekPct = 0;
  if (commits.length) {
    const firstTime = commits[0].time;
    const weeks = new Set();
    for (const c of commits) weeks.add(Math.floor((c.time - firstTime) / (7 * DAY)));
    const totalWeeks = Math.max(1, Math.floor(meta.spanDays / 7) + 1);
    weekPct = Math.min(100, Math.round((weeks.size / totalWeeks) * 100));
    consistency = clamp(weekPct);
  }

  // Community
  const n = contributors.total;
  const community = n === 0 ? 0 : n === 1 ? 30 : n === 2 ? 50 : n <= 5 ? 70 : n <= 15 ? 85 : 100;

  // Hotspot risk (lower churn concentration = healthier)
  const top = hotspots.slice(0, 10);
  const avgRisk = top.length ? top.reduce((s, h) => s + h.risk, 0) / top.length : 0;
  const hotspotScore = commits.length === 0 ? 0 : top.length ? clamp(Math.round(100 - avgRisk)) : 70;

  const factors = [
    { key: 'bus', label: 'Knowledge sharing', score: busScore, weight: 0.25, detail: `Bus factor ${bf}${contributors.total ? ` · top author owns ${contributors.topSharePercent}%` : ''}` },
    { key: 'recency', label: 'Recent activity', score: recency, weight: 0.25, detail: daysSinceLast == null ? 'No commits yet' : `Last commit ${daysSinceLast} day${daysSinceLast === 1 ? '' : 's'} ago` },
    { key: 'consistency', label: 'Consistency', score: consistency, weight: 0.20, detail: commits.length ? `Active in ${weekPct}% of weeks` : 'No commits yet' },
    { key: 'community', label: 'Community', score: community, weight: 0.15, detail: `${n} contributor${n === 1 ? '' : 's'}` },
    { key: 'hotspots', label: 'Code risk', score: hotspotScore, weight: 0.15, detail: top.length ? `${top.length} hotspot${top.length === 1 ? '' : 's'} to watch` : 'No churn data' },
  ];

  const score = Math.round(factors.reduce((s, f) => s + f.score * f.weight, 0));
  const grade = score >= 90 ? 'A+' : score >= 80 ? 'A' : score >= 70 ? 'B' : score >= 60 ? 'C' : score >= 50 ? 'D' : 'F';
  const label = score >= 90 ? 'Excellent' : score >= 80 ? 'Healthy' : score >= 70 ? 'Good' : score >= 60 ? 'Fair' : score >= 50 ? 'Needs care' : 'At risk';

  return { score, grade, label, factors };
}
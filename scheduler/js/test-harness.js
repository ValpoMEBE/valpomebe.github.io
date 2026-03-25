/* ╔══════════════════════════════════════════════════════════════╗
   ║  TEST HARNESS — Correctness + benchmark runner for the      ║
   ║  scheduler optimizer (IFS).                                 ║
   ║                                                              ║
   ║  Depends on: parser.js, optimizer.js, COURSES global         ║
   ╚══════════════════════════════════════════════════════════════╝ */

// ── Dataset definitions ──────────────────────────────────────

const DATASETS = [
  {
    name: 'minimal',
    description: 'Correctness baseline — 5 courses, 7 slots',
    assertions: [
      { type: 'hardViolations', expected: 0 },
      { type: 'allPlaced', expected: true },
      { type: 'scoreFinite', expected: true },
    ],
  },
  {
    name: 'tight-slots',
    description: 'Feasibility stress — 12 courses, 5 slots',
    assertions: [
      { type: 'hardViolations', expected: 0 },
      { type: 'scoreFinite', expected: true },
      // allPlaced is NOT expected — some will be unscheduled
    ],
  },
  {
    name: 'heavy-labs',
    description: 'Lab-heavy — 20 courses with altWeeks labs',
    assertions: [
      { type: 'hardViolations', expected: 0 },
      { type: 'allPlaced', expected: true },
      { type: 'modeMatching', expected: true },
      { type: 'scoreFinite', expected: true },
    ],
  },
  {
    name: 'cohort-pressure',
    description: 'Student conflicts — 25 courses, Jr/Sr pressure',
    assertions: [
      { type: 'hardViolations', expected: 0 },
      { type: 'allPlaced', expected: true },
      { type: 'scoreFinite', expected: true },
    ],
  },
  {
    name: 'faculty-constrained',
    description: 'Faculty prefs — prohibited slots, special rules',
    assertions: [
      { type: 'hardViolations', expected: 0 },
      { type: 'allPlaced', expected: true },
      { type: 'prohibitedSlotsRespected', expected: true },
      { type: 'scoreFinite', expected: true },
    ],
  },
  {
    name: 'full-realistic',
    description: 'Full Valpo MEBE Fall 2026 — 78 courses',
    assertions: [
      { type: 'hardViolations', expected: 0 },
      { type: 'allPlaced', expected: true },
      { type: 'modeMatching', expected: true },
      { type: 'scoreFinite', expected: true },
    ],
  },
];

// ── Base URL detection ───────────────────────────────────────

function getBaseUrl() {
  if (location.pathname.startsWith('/dev/')) return '/dev';
  return '';
}

// ── Default weights ──────────────────────────────────────────

function getDefaultWeights() {
  return {
    cohortConflict: 9,
    facultyPref: 8,
    singleSectionAfternoon: 10,
    backToBack: 6,
    specialConstraints: 10,
  };
}

// ── Data loading ─────────────────────────────────────────────

async function loadDataset(name) {
  const base = getBaseUrl();
  const dir = `${base}/scheduler/test-data/${name}`;

  const [masterResp, slotsResp, prefsResp] = await Promise.all([
    fetch(`${dir}/master.csv`),
    fetch(`${dir}/timeslots.csv`),
    fetch(`${dir}/preferences.csv`),
  ]);

  if (!masterResp.ok) throw new Error(`Failed to load ${dir}/master.csv (${masterResp.status})`);
  if (!slotsResp.ok) throw new Error(`Failed to load ${dir}/timeslots.csv (${slotsResp.status})`);

  const masterText = await masterResp.text();
  const slotsText = await slotsResp.text();

  const { courses, frozen } = parseMasterCSV(masterText);
  const slots = parseTimeslotsCSV(slotsText);

  let facultyPrefs = { preferences: new Map(), specialRules: [] };
  if (prefsResp.ok) {
    const prefsText = await prefsResp.text();
    if (prefsText.trim()) {
      facultyPrefs = parseFacultyPrefsCSV(prefsText);
    }
  }

  return { courses, frozen, slots, facultyPrefs };
}

// ── Assertion checkers ───────────────────────────────────────

function checkAssertion(assertion, result) {
  switch (assertion.type) {
    case 'hardViolations': {
      const count = result.constraintReport.hardViolations.length;
      return { pass: count === assertion.expected, actual: count, label: `Hard violations: ${count}` };
    }
    case 'allPlaced': {
      const placed = result.unscheduled.length === 0;
      return { pass: placed === assertion.expected, actual: result.unscheduled.length, label: `Unscheduled: ${result.unscheduled.length}` };
    }
    case 'scoreFinite': {
      const finite = isFinite(result.score) && result.score >= 0;
      return { pass: finite === assertion.expected, actual: result.score, label: `Score: ${result.score}` };
    }
    case 'modeMatching': {
      let mismatch = 0;
      for (const item of result.scheduled) {
        if (item.course.isExternal) continue;
        if (item.course.mode && item.slot.format && item.course.mode !== item.slot.format) mismatch++;
      }
      return { pass: mismatch === 0, actual: mismatch, label: `Mode mismatches: ${mismatch}` };
    }
    case 'prohibitedSlotsRespected': {
      const prohibViolations = result.constraintReport.hardViolations.filter(v => v.type === 'prohibited_slot');
      return { pass: prohibViolations.length === 0, actual: prohibViolations.length, label: `Prohibited slot violations: ${prohibViolations.length}` };
    }
    default:
      return { pass: false, actual: 'unknown', label: `Unknown assertion: ${assertion.type}` };
  }
}

// ── Statistics ────────────────────────────────────────────────

function computeStats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return { min: 0, max: 0, mean: 0, median: 0, stdDev: 0 };
  const mean = sorted.reduce((s, v) => s + v, 0) / n;
  const median = n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[Math.floor(n / 2)];
  const variance = sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const stdDev = Math.sqrt(variance);
  return { min: sorted[0], max: sorted[n - 1], mean, median, stdDev };
}

// ── Benchmark runner ─────────────────────────────────────────

async function runBenchmark(dataset, parsedData, numRuns, onProgress) {
  const results = [];
  for (let seed = 1; seed <= numRuns; seed++) {
    if (onProgress) onProgress(seed, numRuns);

    // Yield to UI between runs
    await new Promise(r => setTimeout(r, 0));

    const t0 = performance.now();
    const result = optimizeSchedule(
      parsedData.courses, parsedData.frozen, parsedData.slots,
      parsedData.facultyPrefs, getDefaultWeights(), seed
    );
    const elapsed = performance.now() - t0;

    results.push({
      seed,
      score: result.score,
      breakdown: result.breakdown,
      unscheduled: result.unscheduled.length,
      hardViolations: result.constraintReport.hardViolations.length,
      time: elapsed,
    });
  }
  return results;
}

// ── Logging ──────────────────────────────────────────────────

function log(msg) {
  const el = document.getElementById('test-log');
  const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
  el.value += `[${ts}] ${msg}\n`;
  el.scrollTop = el.scrollHeight;
}

// ── Progress ─────────────────────────────────────────────────

function showProgress(text) {
  const bar = document.getElementById('progress-bar');
  const span = document.getElementById('progress-text');
  bar.style.display = '';
  span.textContent = text;
}

function hideProgress() {
  document.getElementById('progress-bar').style.display = 'none';
}

// ── UI: Render correctness results ───────────────────────────

function renderCorrectness(datasetResults) {
  const container = document.getElementById('correctness-results');
  container.innerHTML = '';

  for (const dr of datasetResults) {
    const card = document.createElement('div');
    card.className = 'th-dataset-card';

    const allPass = dr.assertions.every(a => a.pass);
    const badgeClass = dr.skipped ? 'th-badge-skip' : (allPass ? 'th-badge-pass' : 'th-badge-fail');
    const badgeText = dr.skipped ? 'SKIP' : (allPass ? 'PASS' : 'FAIL');

    let headerHtml = `
      <div class="th-dataset-header">
        <span class="th-dataset-name">${dr.name}</span>
        <span class="th-dataset-desc">${dr.description}</span>
        <span class="th-badge ${badgeClass}">${badgeText}</span>
      </div>`;

    let assertHtml = '';
    if (dr.skipped) {
      assertHtml = `<ul class="th-assertions"><li style="color:var(--th-muted)">${dr.skipReason}</li></ul>`;
    } else {
      assertHtml = '<ul class="th-assertions">';
      for (const a of dr.assertions) {
        const cls = a.pass ? 'th-assert-pass' : 'th-assert-fail';
        assertHtml += `<li class="${cls}">${a.label}</li>`;
      }
      assertHtml += '</ul>';
    }

    card.innerHTML = headerHtml + assertHtml;
    container.appendChild(card);
  }
}

// ── UI: Render benchmark table ───────────────────────────────

function renderBenchmarks(benchmarkResults) {
  const table = document.getElementById('benchmark-table');
  const tbody = document.getElementById('benchmark-tbody');
  const placeholder = document.getElementById('benchmark-placeholder');

  tbody.innerHTML = '';
  placeholder.style.display = 'none';
  table.style.display = '';

  for (const br of benchmarkResults) {
    if (br.skipped) continue;
    const scores = computeStats(br.results.map(r => r.score));
    const times = computeStats(br.results.map(r => r.time));

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-family:inherit; font-weight:600;">${br.name}</td>
      <td>${fmt(scores.min)}</td>
      <td>${fmt(scores.max)}</td>
      <td>${fmt(scores.mean)}</td>
      <td>${fmt(scores.median)}</td>
      <td>${fmt(scores.stdDev)}</td>
      <td>${fmt(times.mean)}</td>`;
    tbody.appendChild(tr);
  }
}

// ── UI: Render breakdown ─────────────────────────────────────

function renderBreakdown(benchmarkResults) {
  const container = document.getElementById('breakdown-results');
  const placeholder = document.getElementById('breakdown-placeholder');
  placeholder.style.display = 'none';

  // Remove any previous tables (keep placeholder)
  container.querySelectorAll('.th-breakdown-table').forEach(el => el.remove());

  for (const br of benchmarkResults) {
    if (br.skipped || !br.results.length) continue;

    // Average each breakdown key across runs
    const keys = br.results[0].breakdown ? Object.keys(br.results[0].breakdown) : [];
    if (keys.length === 0) continue;

    const avgs = {};
    for (const k of keys) {
      const vals = br.results.map(r => (r.breakdown && r.breakdown[k]) || 0);
      avgs[k] = computeStats(vals);
    }

    const table = document.createElement('table');
    table.className = 'th-breakdown-table';
    table.innerHTML = `
      <caption>${br.name}</caption>
      <thead><tr><th>Constraint</th><th>Mean</th><th>Min</th><th>Max</th><th>StdDev</th></tr></thead>
      <tbody>
        ${keys.map(k => `<tr>
          <td style="font-family:inherit;">${k}</td>
          <td>${fmt(avgs[k].mean)}</td>
          <td>${fmt(avgs[k].min)}</td>
          <td>${fmt(avgs[k].max)}</td>
          <td>${fmt(avgs[k].stdDev)}</td>
        </tr>`).join('')}
      </tbody>`;
    container.appendChild(table);
  }
}

// ── Formatting helper ────────────────────────────────────────

function fmt(n) {
  if (n === undefined || n === null) return '-';
  if (!isFinite(n)) return String(n);
  return n < 10 ? n.toFixed(2) : n.toFixed(1);
}

// ── Button state ─────────────────────────────────────────────

function setButtonsEnabled(enabled) {
  document.getElementById('btn-run-all').disabled = !enabled;
  document.getElementById('btn-run-correctness').disabled = !enabled;
}

// ── Run correctness only ─────────────────────────────────────

async function runCorrectnessOnly() {
  setButtonsEnabled(false);
  const logEl = document.getElementById('test-log');
  logEl.value = '';
  log('=== Correctness Tests ===');

  const correctnessResults = [];
  const total = DATASETS.length;

  for (let i = 0; i < total; i++) {
    const ds = DATASETS[i];
    showProgress(`Loading dataset ${i + 1}/${total}: ${ds.name}...`);
    await new Promise(r => setTimeout(r, 0));

    let parsedData;
    try {
      parsedData = await loadDataset(ds.name);
    } catch (err) {
      log(`[SKIP] ${ds.name}: ${err.message}`);
      correctnessResults.push({
        name: ds.name,
        description: ds.description,
        assertions: [],
        skipped: true,
        skipReason: err.message,
      });
      continue;
    }

    log(`Running ${ds.name} (seed=42)...`);
    showProgress(`Running correctness: ${ds.name} (${i + 1}/${total})...`);
    await new Promise(r => setTimeout(r, 0));

    const result = optimizeSchedule(
      parsedData.courses, parsedData.frozen, parsedData.slots,
      parsedData.facultyPrefs, getDefaultWeights(), 42
    );

    const assertionResults = ds.assertions.map(a => checkAssertion(a, result));
    const allPass = assertionResults.every(a => a.pass);

    for (const ar of assertionResults) {
      log(`  ${ar.pass ? 'PASS' : 'FAIL'} ${ar.label}`);
    }
    log(`  => ${ds.name}: ${allPass ? 'PASS' : 'FAIL'}`);

    correctnessResults.push({
      name: ds.name,
      description: ds.description,
      assertions: assertionResults,
      skipped: false,
    });
  }

  renderCorrectness(correctnessResults);
  hideProgress();
  setButtonsEnabled(true);
  log('=== Correctness complete ===');
}

// ── Run all (correctness + benchmarks) ───────────────────────

async function runAll() {
  setButtonsEnabled(false);
  const logEl = document.getElementById('test-log');
  logEl.value = '';
  const numRuns = parseInt(document.getElementById('input-runs').value, 10) || 20;

  log('=== Full Run: Correctness + Benchmarks ===');
  log(`Benchmark runs per dataset: ${numRuns}`);

  const correctnessResults = [];
  const benchmarkResults = [];
  const total = DATASETS.length;

  // Phase 1: Load all datasets
  const loadedData = new Map();
  for (let i = 0; i < total; i++) {
    const ds = DATASETS[i];
    showProgress(`Loading dataset ${i + 1}/${total}: ${ds.name}...`);
    await new Promise(r => setTimeout(r, 0));

    try {
      loadedData.set(ds.name, await loadDataset(ds.name));
    } catch (err) {
      log(`[SKIP] ${ds.name}: ${err.message}`);
      loadedData.set(ds.name, null);
    }
  }

  // Phase 2: Correctness (seed=42)
  log('');
  log('--- Correctness ---');
  for (let i = 0; i < total; i++) {
    const ds = DATASETS[i];
    const parsedData = loadedData.get(ds.name);

    if (!parsedData) {
      correctnessResults.push({
        name: ds.name,
        description: ds.description,
        assertions: [],
        skipped: true,
        skipReason: 'Dataset failed to load',
      });
      continue;
    }

    showProgress(`Correctness: ${ds.name} (${i + 1}/${total})...`);
    await new Promise(r => setTimeout(r, 0));

    const result = optimizeSchedule(
      parsedData.courses, parsedData.frozen, parsedData.slots,
      parsedData.facultyPrefs, getDefaultWeights(), 42
    );

    const assertionResults = ds.assertions.map(a => checkAssertion(a, result));
    const allPass = assertionResults.every(a => a.pass);

    log(`${ds.name}:`);
    for (const ar of assertionResults) {
      log(`  ${ar.pass ? 'PASS' : 'FAIL'} ${ar.label}`);
    }
    log(`  => ${allPass ? 'PASS' : 'FAIL'}`);

    correctnessResults.push({
      name: ds.name,
      description: ds.description,
      assertions: assertionResults,
      skipped: false,
    });
  }

  renderCorrectness(correctnessResults);

  // Phase 3: Benchmarks (N runs)
  log('');
  log('--- Benchmarks ---');
  for (let i = 0; i < total; i++) {
    const ds = DATASETS[i];
    const parsedData = loadedData.get(ds.name);

    if (!parsedData) {
      benchmarkResults.push({ name: ds.name, skipped: true, results: [] });
      continue;
    }

    log(`Benchmarking ${ds.name} (${numRuns} runs)...`);

    const results = await runBenchmark(ds, parsedData, numRuns, (seed, max) => {
      showProgress(`Benchmarking ${ds.name} (${i + 1}/${total}) — seed ${seed}/${max}`);
    });

    const scores = computeStats(results.map(r => r.score));
    const times = computeStats(results.map(r => r.time));

    log(`  Score — min: ${fmt(scores.min)}, max: ${fmt(scores.max)}, mean: ${fmt(scores.mean)}, stdDev: ${fmt(scores.stdDev)}`);
    log(`  Time  — mean: ${fmt(times.mean)} ms`);

    benchmarkResults.push({ name: ds.name, skipped: false, results });
  }

  renderBenchmarks(benchmarkResults);
  renderBreakdown(benchmarkResults);
  hideProgress();
  setButtonsEnabled(true);
  log('');
  log('=== Full run complete ===');
}

// ── Init ─────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-run-all').addEventListener('click', () => runAll());
  document.getElementById('btn-run-correctness').addEventListener('click', () => runCorrectnessOnly());
});

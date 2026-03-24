/* ╔══════════════════════════════════════════════════════════════╗
   ║  MINOR AUDIT ENGINE                                        ║
   ║  Evaluates transcript against selected minor definitions   ║
   ║  and renders results below the main degree audit.          ║
   ╚══════════════════════════════════════════════════════════════╝ */

// ── Helpers ──────────────────────────────────────────────────────

/** Parse "PHYS 141L" → { dept: "PHYS", num: 141 } */
function parseCourseCode(code) {
  const m = code.match(/^([A-Z]{2,4})\s+(\d{1,4})/);
  if (!m) return null;
  return { dept: m[1], num: parseInt(m[2], 10) };
}

/** Build a flat list of all transcript courses (matched + unmatched) with status */
function buildTranscriptPool(matched, unmatched) {
  const pool = [];
  const seen = new Set();
  const poolByCode = {};

  for (const m of matched) {
    const status = getCourseStatus(m.active.grade);
    if (status === 'failed') continue;          // skip F grades
    const code = m.code;

    // Bundled labs (e.g. ECE 221L → ECE 221): add lab credits to parent entry
    if (typeof CODE_ALIASES !== 'undefined' && CODE_ALIASES[code]) {
      const parentCode = CODE_ALIASES[code].replace(/_/g, ' ');
      if (parentCode !== code && poolByCode[parentCode]) {
        poolByCode[parentCode].credits += m.active.credits || 0;
        seen.add(code);
        continue;
      }
    }

    if (seen.has(code)) continue;
    seen.add(code);
    const entry = {
      code,
      credits: m.active.credits || (m.courseData ? m.courseData.credits : 3),
      grade: m.active.grade,
      status,
    };
    pool.push(entry);
    poolByCode[code] = entry;
  }

  for (const u of (unmatched || [])) {
    const status = getCourseStatus(u.active.grade);
    if (status === 'failed') continue;          // skip F grades
    const code = u.code;
    if (seen.has(code)) continue;
    seen.add(code);
    const entry = {
      code,
      credits: u.active.credits || 3,
      grade: u.active.grade,
      status,
    };
    pool.push(entry);
    poolByCode[code] = entry;
  }
  return pool;
}

/** Collect all course codes "presented for the degree" in the major audit.
 *  Includes every required course in the degree plan, elective group fills,
 *  placeholder fills, AND any transcript course that qualifies for an elective
 *  group (since it could be presented for the degree). */
function buildMajorUsedSet(auditResult, program, pool) {
  const used = new Set();
  // All courses in the degree plan (required, in-progress, remaining — all are "presented")
  for (const c of auditResult.audit) {
    used.add(c.code);
    if (c.filledBy) used.add(c.filledBy);
  }
  // Group card fills (elective courses matched to grouped slots)
  for (const gc of auditResult.groupCards) {
    for (const fc of gc.filledCourses) {
      used.add(fc.code);
    }
  }
  // Any transcript course that qualifies for an elective group in this program
  // could be presented for the degree, so it can't serve as above-and-beyond
  const groups = ELECTIVE_GROUPS[program] || [];
  for (const g of groups) {
    const approvedSet = buildApprovedSet(g.approvedLists);
    for (const entry of pool) {
      if (used.has(entry.code)) continue;
      if (isApprovedElective(entry.code, approvedSet, g.blanketDepts || [], g.checkWorldLang)) {
        used.add(entry.code);
      }
    }
  }
  return used;
}

/** Check if a course code matches a requirement's criteria */
function courseMatchesDeptLevel(code, credits, deptLevel) {
  const parsed = parseCourseCode(code);
  if (!parsed) return false;
  if (deptLevel.min_credits_each && credits < deptLevel.min_credits_each) return false;
  return deptLevel.depts.includes(parsed.dept) && parsed.num >= (deptLevel.min_level || 0);
}

/** Check if a course is in the exclude list */
function isExcluded(code, exclude) {
  if (!exclude || exclude.length === 0) return false;
  return exclude.includes(code);
}

/** Check if a course matches approved_extras list */
function isApprovedExtra(code, extras) {
  if (!extras || extras.length === 0) return false;
  return extras.includes(code);
}

// ── Requirement Evaluators ───────────────────────────────────────

function evalRequired(req, pool, usedCodes) {
  const filled = [];
  const missing = [];

  for (const courseCode of req.courses) {
    // Check substitutions
    let matchCode = courseCode;
    let multiSubFilled = false;
    if (req.substitutions) {
      for (const [sub, target] of Object.entries(req.substitutions)) {
        if (target !== courseCode) continue;

        if (sub.includes('+')) {
          // Multi-course substitution: ALL courses must be present
          const subCodes = sub.split('+').map(s => s.trim());
          const subEntries = [];
          let allFound = true;
          for (const sc of subCodes) {
            const entry = pool.find(p => p.code === sc && !usedCodes.has(p.code));
            if (entry) {
              subEntries.push(entry);
            } else {
              allFound = false;
              break;
            }
          }
          if (allFound) {
            for (const se of subEntries) {
              filled.push({ code: se.code, grade: se.grade, credits: se.credits });
              usedCodes.add(se.code);
            }
            multiSubFilled = true;
            break;
          }
        } else {
          // Single-course substitution
          const subEntry = pool.find(p => p.code === sub && !usedCodes.has(p.code));
          if (subEntry) {
            matchCode = sub;
            break;
          }
        }
      }
    }

    if (!multiSubFilled) {
      const entry = pool.find(p => p.code === matchCode && !usedCodes.has(p.code));
      if (entry) {
        filled.push({ code: entry.code, grade: entry.grade, credits: entry.credits });
        usedCodes.add(entry.code);
      } else {
        missing.push(courseCode);
      }
    }
  }

  return {
    label: req.label,
    type: req.type,
    met: missing.length === 0,
    filled,
    missing,
    creditsApplied: filled.reduce((s, c) => s + c.credits, 0),
  };
}

function evalPick(req, pool, usedCodes) {
  const needed = req.pick || 1;
  const filled = [];

  // course_groups: each element is an array of courses that must ALL be present
  // e.g. [["ECE 263"], ["ECE 281", "ME 261"]] means ECE 263 alone OR both ECE 281 + ME 261
  if (req.course_groups) {
    for (const group of req.course_groups) {
      if (filled.length >= needed) break;
      // Check if ALL courses in this group are available in pool
      const groupEntries = [];
      let allFound = true;
      for (const code of group) {
        const entry = pool.find(e => e.code === code && !usedCodes.has(e.code));
        if (entry) {
          groupEntries.push(entry);
        } else {
          allFound = false;
          break;
        }
      }
      if (allFound && groupEntries.length === group.length) {
        for (const entry of groupEntries) {
          filled.push({ code: entry.code, grade: entry.grade, credits: entry.credits });
          usedCodes.add(entry.code);
        }
        break; // One group match satisfies one pick
      }
    }
  }

  // Standard flat course list matching (if no course_groups or not enough filled)
  for (const entry of pool) {
    if (filled.length >= needed) break;
    if (usedCodes.has(entry.code)) continue;
    if (isExcluded(entry.code, req.exclude)) continue;

    let matches = false;
    // Check explicit course list
    if (req.courses && req.courses.includes(entry.code)) {
      matches = true;
    }
    // Check dept_level criteria
    if (!matches && req.dept_level) {
      matches = courseMatchesDeptLevel(entry.code, entry.credits, req.dept_level);
    }

    if (matches) {
      filled.push({ code: entry.code, grade: entry.grade, credits: entry.credits });
      usedCodes.add(entry.code);
    }
  }

  // For course_groups, count filled groups not individual courses
  const metCount = req.course_groups ? (filled.length > 0 ? 1 : 0) : filled.length;

  return {
    label: req.label,
    type: req.type,
    met: metCount >= needed,
    filled,
    missing: [],
    needed,
    creditsApplied: filled.reduce((s, c) => s + c.credits, 0),
  };
}

function evalCredits(req, pool, usedCodes) {
  const target = req.credits || 0;
  const filled = [];
  let total = 0;
  const maxFrom = req.max_from || {};
  const maxFromUsed = {};

  for (const entry of pool) {
    if (total >= target) break;
    if (usedCodes.has(entry.code)) continue;
    if (isExcluded(entry.code, req.exclude)) continue;

    // Check max_from caps
    if (maxFrom[entry.code] !== undefined) {
      const used = maxFromUsed[entry.code] || 0;
      if (used >= maxFrom[entry.code]) continue;
    }

    let matches = false;
    // Check department + level
    if (req.depts) {
      const parsed = parseCourseCode(entry.code);
      if (parsed && req.depts.includes(parsed.dept) && parsed.num >= (req.min_level || 0)) {
        matches = true;
      }
    }
    // Check approved extras
    if (!matches && isApprovedExtra(entry.code, req.approved_extras)) {
      matches = true;
    }
    // Check substitutions
    if (!matches && req.substitutions) {
      for (const [sub, target_code] of Object.entries(req.substitutions)) {
        if (entry.code === sub) { matches = true; break; }
      }
    }

    if (matches) {
      filled.push({ code: entry.code, grade: entry.grade, credits: entry.credits });
      total += entry.credits;
      usedCodes.add(entry.code);
      if (maxFrom[entry.code] !== undefined) {
        maxFromUsed[entry.code] = (maxFromUsed[entry.code] || 0) + entry.credits;
      }
    }
  }

  // Check sub_requirements (e.g., chemistry "8 credits at 200+")
  let subReqMet = true;
  let subReqInfo = null;
  if (req.sub_requirements) {
    for (const sub of req.sub_requirements) {
      let subTotal = 0;
      for (const f of filled) {
        const parsed = parseCourseCode(f.code);
        if (parsed && parsed.num >= (sub.min_level || 0)) {
          subTotal += f.credits;
        }
      }
      if (subTotal < sub.credits) {
        subReqMet = false;
        subReqInfo = { label: sub.label, have: subTotal, need: sub.credits };
      }
    }
  }

  return {
    label: req.label,
    type: req.type,
    met: total >= target && subReqMet,
    filled,
    missing: [],
    creditsNeeded: target,
    creditsApplied: total,
    subReqInfo,
  };
}

// ── Main Minor Audit ─────────────────────────────────────────────

function computeMinorAudit(pool, minorDef, majorUsedSet, otherAboveBeyondCodes) {
  const usedCodes = new Set();
  const results = [];

  for (const req of minorDef.requirements) {
    let result;
    switch (req.type) {
      case 'required':
        result = evalRequired(req, pool, usedCodes);
        break;
      case 'pick':
        result = evalPick(req, pool, usedCodes);
        break;
      case 'credits':
        result = evalCredits(req, pool, usedCodes);
        break;
      default:
        continue;
    }
    results.push(result);
  }

  const totalApplied = results.reduce((s, r) => s + r.creditsApplied, 0);
  const allReqsMet = results.every(r => r.met);

  // Check above-and-beyond
  const aab = checkAboveAndBeyond(results, pool, majorUsedSet, otherAboveBeyondCodes);

  return {
    minorId: minorDef.id,
    name: minorDef.name,
    minCredits: minorDef.min_credits,
    totalApplied,
    requirements: results,
    aboveAndBeyond: aab,
    overallMet: allReqsMet && totalApplied >= minorDef.min_credits && aab.met,
  };
}

function checkAboveAndBeyond(reqResults, pool, majorUsedSet, otherAboveBeyondCodes) {
  // Gather all courses used for this minor
  const minorCourses = [];
  for (const r of reqResults) {
    for (const f of r.filled) minorCourses.push(f);
  }

  // Find one that's 3+ credits, 200+, not in major used set, not another minor's A&B
  for (const c of minorCourses) {
    const parsed = parseCourseCode(c.code);
    if (!parsed) continue;
    if (c.credits < 3) continue;
    if (parsed.num < 200) continue;
    if (majorUsedSet.has(c.code)) continue;
    if (otherAboveBeyondCodes.has(c.code)) continue;
    return { met: true, course: c.code };
  }

  // Also check pool for courses that qualify for this minor but weren't needed for a req
  // (student might have extra courses)
  for (const entry of pool) {
    const parsed = parseCourseCode(entry.code);
    if (!parsed) continue;
    if (entry.credits < 3) continue;
    if (parsed.num < 200) continue;
    if (majorUsedSet.has(entry.code)) continue;
    if (otherAboveBeyondCodes.has(entry.code)) continue;

    // Check if this course is related to the minor's department areas
    let related = false;
    for (const r of reqResults) {
      if (r.filled.some(f => f.code === entry.code)) { related = true; break; }
    }
    if (!related) continue;
    return { met: true, course: entry.code };
  }

  return { met: false, course: null };
}

function computeAllMinors(matched, unmatched, auditResult, selectedMinorIds, program) {
  const pool = buildTranscriptPool(matched, unmatched);
  const majorUsedSet = buildMajorUsedSet(auditResult, program, pool);
  const otherAboveBeyondCodes = new Set();
  const results = [];

  for (const minorId of selectedMinorIds) {
    const minorDef = MINORS_DATA[minorId];
    if (!minorDef) continue;
    const result = computeMinorAudit(pool, minorDef, majorUsedSet, otherAboveBeyondCodes);
    if (result.aboveAndBeyond.met && result.aboveAndBeyond.course) {
      otherAboveBeyondCodes.add(result.aboveAndBeyond.course);
    }
    results.push(result);
  }

  return results;
}

// ── Minor Picker UI ──────────────────────────────────────────────

function initMinorPicker() {
  const picker = document.getElementById('minor-picker');
  if (!picker || typeof MINORS_DATA === 'undefined') return;

  const keys = Object.keys(MINORS_DATA).sort((a, b) =>
    MINORS_DATA[a].name.localeCompare(MINORS_DATA[b].name)
  );

  for (const key of keys) {
    const minor = MINORS_DATA[key];
    const label = document.createElement('label');
    label.className = 'minor-checkbox-label';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = key;
    cb.addEventListener('change', () => toggleMinor(key, cb.checked));
    label.appendChild(cb);
    label.appendChild(document.createTextNode(' ' + minor.name));
    picker.appendChild(label);
  }
}

function toggleMinorPicker() {
  const picker = document.getElementById('minor-picker');
  const arrow = document.querySelector('.minor-toggle-arrow');
  if (!picker) return;
  const visible = picker.style.display !== 'none';
  picker.style.display = visible ? 'none' : '';
  if (arrow) arrow.textContent = visible ? '\u25BC' : '\u25B2';
}

function toggleMinor(key, checked) {
  if (!AUDIT_STATE.selectedMinors) AUDIT_STATE.selectedMinors = [];
  if (checked) {
    if (!AUDIT_STATE.selectedMinors.includes(key)) {
      AUDIT_STATE.selectedMinors.push(key);
    }
  } else {
    AUDIT_STATE.selectedMinors = AUDIT_STATE.selectedMinors.filter(k => k !== key);
  }
  updateMinorTags();
  rerunMinors();
}

function updateMinorTags() {
  const container = document.getElementById('minor-tags');
  if (!container) return;
  container.innerHTML = '';
  for (const key of (AUDIT_STATE.selectedMinors || [])) {
    const minor = MINORS_DATA[key];
    if (!minor) continue;
    const tag = document.createElement('span');
    tag.className = 'minor-tag';
    tag.innerHTML = minor.name +
      ' <button class="minor-tag-remove" onclick="removeMinor(\'' + key + '\')">&times;</button>';
    container.appendChild(tag);
  }
}

function removeMinor(key) {
  AUDIT_STATE.selectedMinors = (AUDIT_STATE.selectedMinors || []).filter(k => k !== key);
  // Uncheck the checkbox
  const picker = document.getElementById('minor-picker');
  if (picker) {
    const cb = picker.querySelector('input[value="' + key + '"]');
    if (cb) cb.checked = false;
  }
  updateMinorTags();
  rerunMinors();
}

// ── Run minor audit (called from runAudit / rerunAudit) ──────────

function rerunMinors() {
  if (!AUDIT_STATE.lastMatched) return;
  const selected = AUDIT_STATE.selectedMinors || [];
  if (selected.length === 0) {
    clearMinorResults();
    return;
  }
  const auditResult = computeAudit(
    AUDIT_STATE.lastMatched,
    AUDIT_STATE.program,
    AUDIT_STATE.lastCodeIndex,
    AUDIT_STATE.lastUnmatched
  );
  const minorResults = computeAllMinors(
    AUDIT_STATE.lastMatched,
    AUDIT_STATE.lastUnmatched,
    auditResult,
    selected,
    AUDIT_STATE.program
  );
  renderMinorResults(minorResults);
}

function clearMinorResults() {
  const section = document.getElementById('minor-results-section');
  if (section) section.style.display = 'none';
  const container = document.getElementById('minor-results-container');
  if (container) container.innerHTML = '';
}

// ── Rendering ────────────────────────────────────────────────────

function renderMinorResults(results) {
  const section = document.getElementById('minor-results-section');
  const container = document.getElementById('minor-results-container');
  if (!section || !container) return;

  container.innerHTML = '';

  if (results.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = '';

  for (const r of results) {
    container.appendChild(createMinorCard(r));
  }
}

function createMinorCard(result) {
  const card = document.createElement('div');
  card.className = 'minor-audit-card' + (result.overallMet ? ' minor-met' : '');

  // Header
  const header = document.createElement('div');
  header.className = 'minor-card-header';

  const statusIcon = document.createElement('span');
  statusIcon.className = 'minor-status-icon ' + (result.overallMet ? 'met' : 'unmet');
  statusIcon.textContent = result.overallMet ? '\u2713' : '\u25CB';
  header.appendChild(statusIcon);

  const title = document.createElement('span');
  title.className = 'minor-card-title';
  title.textContent = result.name + ' Minor';
  header.appendChild(title);

  const tally = document.createElement('span');
  tally.className = 'minor-card-tally';
  tally.textContent = result.totalApplied + ' / ' + result.minCredits + ' cr';
  header.appendChild(tally);

  card.appendChild(header);

  // Progress bar
  const pct = Math.min(100, Math.round((result.totalApplied / result.minCredits) * 100));
  const progressWrap = document.createElement('div');
  progressWrap.className = 'minor-progress-wrap';
  const progressBar = document.createElement('div');
  progressBar.className = 'minor-progress-bar';
  progressBar.style.width = pct + '%';
  progressBar.classList.add(pct >= 100 ? 'full' : pct > 0 ? 'partial' : 'empty');
  progressWrap.appendChild(progressBar);
  card.appendChild(progressWrap);

  // Requirements
  const reqList = document.createElement('div');
  reqList.className = 'minor-req-list';

  for (const req of result.requirements) {
    reqList.appendChild(createReqRow(req));
  }

  card.appendChild(reqList);

  // Above-and-beyond row
  const aabRow = document.createElement('div');
  aabRow.className = 'minor-aab-row ' + (result.aboveAndBeyond.met ? 'met' : 'unmet');
  const aabIcon = document.createElement('span');
  aabIcon.className = 'minor-req-icon ' + (result.aboveAndBeyond.met ? 'met' : 'unmet');
  aabIcon.textContent = result.aboveAndBeyond.met ? '\u2713' : '\u2717';
  aabRow.appendChild(aabIcon);

  const aabText = document.createElement('span');
  aabText.className = 'minor-aab-text';
  if (result.aboveAndBeyond.met) {
    aabText.textContent = 'Above & Beyond: ' + result.aboveAndBeyond.course;
  } else {
    aabText.textContent = 'Above & Beyond: need 1 course (200+, 3+ cr) not used for degree';
  }
  aabRow.appendChild(aabText);
  card.appendChild(aabRow);

  return card;
}

function createReqRow(req) {
  const row = document.createElement('div');
  row.className = 'minor-req-row ' + (req.met ? 'met' : 'unmet');

  const icon = document.createElement('span');
  icon.className = 'minor-req-icon ' + (req.met ? 'met' : 'unmet');
  icon.textContent = req.met ? '\u2713' : '\u25CB';
  row.appendChild(icon);

  const label = document.createElement('span');
  label.className = 'minor-req-label';
  label.textContent = req.label;
  row.appendChild(label);

  const detail = document.createElement('span');
  detail.className = 'minor-req-detail';

  if (req.filled.length > 0) {
    const chips = req.filled.map(f => {
      const gradeTxt = f.grade || 'IP';
      const gradeClass = f.grade ? getGradeClass(f.grade) : 'grade-ip';
      return '<span class="minor-course-chip">' + f.code +
        ' <span class="minor-grade ' + gradeClass + '">' + gradeTxt + '</span>' +
        ' (' + f.credits + ' cr)</span>';
    }).join(' ');
    detail.innerHTML = chips;
  }

  if (req.type === 'credits' && !req.met) {
    const remaining = Math.max(0, req.creditsNeeded - req.creditsApplied);
    detail.innerHTML += '<span class="minor-need">' + remaining + ' cr needed</span>';
  }

  if (req.type === 'required' && req.missing.length > 0) {
    detail.innerHTML += '<span class="minor-need">Need: ' + req.missing.join(', ') + '</span>';
  }

  if (req.type === 'pick' && !req.met) {
    const remaining = (req.needed || 1) - req.filled.length;
    detail.innerHTML += '<span class="minor-need">' + remaining + ' more course(s) needed</span>';
  }

  if (req.subReqInfo && !req.subReqInfo.met !== false) {
    // handled by met flag
  }

  row.appendChild(detail);
  return row;
}

function getGradeClass(grade) {
  if (!grade) return '';
  const g = grade.toUpperCase().replace(/[+-]/g, '');
  if (g === 'A') return 'grade-a';
  if (g === 'B') return 'grade-b';
  if (g === 'C') return 'grade-c';
  if (g === 'D') return 'grade-d';
  if (g === 'F') return 'grade-f';
  if (g === 'TR') return 'grade-tr';
  return '';
}

// ── Initialize picker on DOM ready ───────────────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initMinorPicker);
} else {
  initMinorPicker();
}

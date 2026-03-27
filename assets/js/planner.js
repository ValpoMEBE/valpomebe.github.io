/* ╔══════════════════════════════════════════════════════════════╗
   ║  WHAT-IF PLANNER                                             ║
   ║  Select programs and see a combined 4-year course plan.      ║
   ║  No transcript needed — purely curriculum-based.             ║
   ║                                                              ║
   ║  Requires: scheduling-utils.js, inject-courses.html globals  ║
   ╚══════════════════════════════════════════════════════════════╝ */

// ── All available programs ───────────────────────────────────
const PLANNER_PROGRAMS = {
  ME:            'Mechanical Engineering',
  BE_Biomech:    'BE – Biomechanical',
  BE_Bioelec:    'BE – Bioelectrical',
  BE_Biomed:     'BE – Biomedical',
  CE:            'Civil Engineering',
  CPE:           'Computer Engineering',
  EE:            'Electrical Engineering',
  ENE:           'Environmental Engineering',
  Physics_BS:    'Physics B.S.',
  Math_BS:       'Mathematics B.S.',
  CS_BS:         'Computer Science B.S.',
  Chemistry_BS:  'Chemistry B.S.',
  Music_BA:      'Music B.A.',
};

// ── State ────────────────────────────────────────────────────
let PLANNER_STATE = {
  primary: null,
  secondary: null,
  selectedMinors: [],
  ccEnabled: false,
  mergedPlan: null,
  selected: null, // selected course for detail panel
};

// ── Program Selection ────────────────────────────────────────

function selectPrimaryProgram(prog, btn) {
  // Toggle deselect if re-clicking the same program
  if (PLANNER_STATE.primary === prog) {
    PLANNER_STATE.primary = null;
    PLANNER_STATE.secondary = null;
    PLANNER_STATE.selectedMinors = [];
    if (btn) btn.classList.remove('active');
    hidePlan();
    return;
  }

  PLANNER_STATE.primary = prog;
  PLANNER_STATE.secondary = null;
  PLANNER_STATE.selectedMinors = [];

  // Update button active state (skip current btn to avoid remove+re-add in same frame)
  document.querySelectorAll('#primary-prog-btns .prog-btn').forEach(b => {
    if (b !== btn) b.classList.remove('active');
  });
  if (btn) btn.classList.add('active');

  // Load curriculum for this program
  if (typeof applyCurriculum === 'function') {
    applyCurriculum(prog, 2025);
  }

  // Show secondary row and populate
  const secRow = document.getElementById('secondary-row');
  if (secRow) {
    secRow.style.display = '';
    populateSecondaryButtons();
  }

  // Show minor/CC row and populate
  const minorRow = document.getElementById('minor-row');
  if (minorRow) {
    minorRow.style.display = '';
    populateMinorButtons();
  }
  const ccRow = document.getElementById('cc-row');
  if (ccRow) ccRow.style.display = '';

  // Clear secondary selection UI
  const clearBtn = document.getElementById('clear-secondary-btn');
  if (clearBtn) clearBtn.style.display = 'none';

  // Reset CC toggle
  PLANNER_STATE.ccEnabled = false;
  const ccBtn = document.getElementById('cc-toggle-btn');
  if (ccBtn) ccBtn.classList.remove('active');

  generatePlan();
}

function hidePlan() {
  document.getElementById('secondary-row').style.display = 'none';
  document.getElementById('minor-row').style.display = 'none';
  const ccRow = document.getElementById('cc-row');
  if (ccRow) ccRow.style.display = 'none';
  document.getElementById('planner-stats').style.display = 'none';
  document.getElementById('planner-area').style.display = 'none';
  document.getElementById('planner-legend').style.display = 'none';
  document.getElementById('planner-warning').style.display = 'none';
  document.getElementById('planner-overflow').style.display = 'none';
  closePlannerPanel();
}

function populateSecondaryButtons() {
  const container = document.getElementById('secondary-prog-btns');
  if (!container) return;
  container.innerHTML = '';

  for (const [key, label] of Object.entries(PLANNER_PROGRAMS)) {
    if (key === PLANNER_STATE.primary) continue;
    // Skip generic BE tracks if primary is a BE track
    const primaryIsBE = PLANNER_STATE.primary && PLANNER_STATE.primary.startsWith('BE_');
    if (primaryIsBE && key.startsWith('BE_')) continue;

    const btn = document.createElement('button');
    btn.className = 'prog-btn';
    btn.textContent = label;
    btn.addEventListener('click', () => {
      PLANNER_STATE.secondary = key;
      container.querySelectorAll('.prog-btn').forEach(b => {
        if (b !== btn) b.classList.remove('active');
      });
      btn.classList.add('active');
      const clearBtn = document.getElementById('clear-secondary-btn');
      if (clearBtn) clearBtn.style.display = '';
      generatePlan();
    });
    container.appendChild(btn);
  }
}

function clearSecondaryProgram() {
  PLANNER_STATE.secondary = null;
  const container = document.getElementById('secondary-prog-btns');
  if (container) container.querySelectorAll('.prog-btn').forEach(b => b.classList.remove('active'));
  const clearBtn = document.getElementById('clear-secondary-btn');
  if (clearBtn) clearBtn.style.display = 'none';
  generatePlan();
}

function populateMinorButtons() {
  const container = document.getElementById('minor-btns');
  if (!container || typeof MINORS_DATA === 'undefined') return;
  container.innerHTML = '';

  for (const [key, minor] of Object.entries(MINORS_DATA)) {
    const btn = document.createElement('button');
    btn.className = 'prog-btn minor-toggle-btn';
    btn.textContent = minor.name;
    btn.dataset.minor = key;
    btn.addEventListener('click', () => {
      const idx = PLANNER_STATE.selectedMinors.indexOf(key);
      if (idx >= 0) {
        PLANNER_STATE.selectedMinors.splice(idx, 1);
        btn.classList.remove('active');
      } else {
        PLANNER_STATE.selectedMinors.push(key);
        btn.classList.add('active');
      }
      generatePlan();
    });
    container.appendChild(btn);
  }
}

function toggleCC() {
  PLANNER_STATE.ccEnabled = !PLANNER_STATE.ccEnabled;
  const btn = document.getElementById('cc-toggle-btn');
  if (btn) {
    btn.classList.toggle('active', PLANNER_STATE.ccEnabled);
  }
  if (PLANNER_STATE.primary) generatePlan();
}

// ── Plan Generation ──────────────────────────────────────────

function generatePlan() {
  if (!PLANNER_STATE.primary) return;

  const primary = PLANNER_STATE.primary;
  const secondary = PLANNER_STATE.secondary;

  // Load primary curriculum
  if (typeof applyCurriculum === 'function') {
    applyCurriculum(primary, 2025);
  }

  // Collect primary courses
  const primaryCourses = COURSES_ARRAY.filter(c =>
    c.semesters && c.semesters[primary]
  );

  // Load secondary curriculum if needed
  let secondaryCourses = [];
  if (secondary) {
    if (typeof applyCurriculum === 'function') {
      applyCurriculum(secondary, 2025);
    }
    secondaryCourses = COURSES_ARRAY.filter(c =>
      c.semesters && c.semesters[secondary]
    );
    // Restore primary curriculum
    if (typeof applyCurriculum === 'function') {
      applyCurriculum(primary, 2025);
    }
  }

  // Merge courses
  const merged = mergeCourses(primaryCourses, secondaryCourses, primary, secondary);

  // Add minor courses
  const minorCourses = collectMinorCourses(merged);

  // Add CC courses
  const ccCourses = collectCCCourses([...merged, ...minorCourses]);

  // Combine
  const allCourses = [...merged, ...minorCourses, ...ccCourses];

  // Resolve prereq conflicts and rebalance
  const resolved = resolvePrereqConflicts(allCourses);
  const rebalanced = rebalanceSemesters(resolved);

  // Compute stats
  const stats = computeStats(rebalanced, secondary);

  PLANNER_STATE.mergedPlan = { courses: rebalanced, stats };

  renderPlan(rebalanced, stats);
}

function mergeCourses(primaryCourses, secondaryCourses, primary, secondary) {
  const allIds = new Set();
  const merged = [];

  for (const c of primaryCourses) {
    allIds.add(c.id);
    const inSecondary = secondary && c.semesters && c.semesters[secondary];
    merged.push({
      id: c.id,
      code: c.code,
      title: c.title,
      credits: c.credits || 0,
      tags: c.tags || [],
      prereqs: c.prereqs || [],
      coreqs: c.coreqs || [],
      offered: c.offered || null,
      desc: c.desc || '',
      isPlaceholder: c.isPlaceholder || false,
      origin: inSecondary ? 'shared' : 'primary',
      semester: inSecondary
        ? Math.min(c.semesters[primary], c.semesters[secondary])
        : c.semesters[primary],
    });
  }

  for (const c of secondaryCourses) {
    if (allIds.has(c.id)) continue;
    allIds.add(c.id);
    merged.push({
      id: c.id,
      code: c.code,
      title: c.title,
      credits: c.credits || 0,
      tags: c.tags || [],
      prereqs: c.prereqs || [],
      coreqs: c.coreqs || [],
      offered: c.offered || null,
      desc: c.desc || '',
      isPlaceholder: c.isPlaceholder || false,
      origin: 'secondary',
      semester: c.semesters[secondary],
    });
  }

  return merged;
}

function collectMinorCourses(mergedCourses) {
  if (!PLANNER_STATE.selectedMinors.length) return [];
  if (typeof MINORS_DATA === 'undefined') return [];

  const existingIds = new Set(mergedCourses.map(c => c.id));
  const existingCodes = new Set(mergedCourses.map(c => c.code));
  const minorCourses = [];

  for (const minorKey of PLANNER_STATE.selectedMinors) {
    const minor = MINORS_DATA[minorKey];
    if (!minor || !minor.requirements) continue;

    for (const req of minor.requirements) {
      if (!req.courses) continue;
      for (const courseCode of req.courses) {
        if (existingCodes.has(courseCode)) continue;
        // Find course in COURSES_ARRAY by code
        const course = COURSES_ARRAY.find(c => c.code === courseCode);
        if (!course || existingIds.has(course.id)) continue;
        existingIds.add(course.id);
        existingCodes.add(course.code);
        minorCourses.push({
          id: course.id,
          code: course.code,
          title: course.title,
          credits: course.credits || 0,
          tags: course.tags || [],
          prereqs: course.prereqs || [],
          coreqs: course.coreqs || [],
          offered: course.offered || null,
          desc: course.desc || '',
          isPlaceholder: course.isPlaceholder || false,
          origin: 'minor',
          semester: null, // will be placed by resolvePrereqConflicts
        });
      }
    }
  }

  return minorCourses;
}

function collectCCCourses(existingCourses) {
  if (!PLANNER_STATE.ccEnabled) return [];
  if (typeof CC_SCHOLAR_DATA === 'undefined' || !CC_SCHOLAR_DATA) return [];

  const existingIds = new Set(existingCourses.map(c => c.id));
  const existingCodes = new Set(existingCourses.map(c => c.code));
  const ccCourses = [];

  for (const req of (CC_SCHOLAR_DATA.requirements || [])) {
    if (!req.courses) continue;
    const limit = req.type === 'pick' ? (req.pick || 1) : req.courses.length;
    let added = 0;
    for (const courseCode of req.courses) {
      if (added >= limit) break;
      if (existingCodes.has(courseCode)) { added++; continue; }

      const course = COURSES_ARRAY.find(c => c.code === courseCode);
      if (!course) continue;
      if (existingIds.has(course.id)) { added++; continue; }

      existingIds.add(course.id);
      existingCodes.add(courseCode);
      ccCourses.push({
        id: course.id,
        code: course.code,
        title: course.title,
        credits: course.credits || 0,
        tags: course.tags || [],
        prereqs: course.prereqs || [],
        coreqs: course.coreqs || [],
        offered: course.offered || null,
        desc: course.desc || '',
        isPlaceholder: false,
        origin: 'cc',
        semester: null,
      });
      added++;
    }
  }

  return ccCourses;
}

// ── Prereq Conflict Resolution ───────────────────────────────

function resolvePrereqConflicts(courses) {
  const byId = {};
  for (const c of courses) byId[c.id] = c;
  const allIds = new Set(courses.map(c => c.id));

  // For courses without a semester (minor courses), assign based on prereqs
  // First pass: assign unplaced courses a tentative semester
  for (const c of courses) {
    if (c.semester) continue;
    // Find latest prereq semester
    let latestPrereq = 0;
    for (const entry of (c.prereqs || [])) {
      const pIds = Array.isArray(entry) ? entry : [entry];
      for (const p of pIds) {
        if (byId[p] && byId[p].semester) {
          latestPrereq = Math.max(latestPrereq, byId[p].semester);
        }
      }
    }
    c.semester = latestPrereq + 1;
    // Adjust for offering constraint
    if (c.offered && c.offered !== 'Both') {
      while (semSeason(c.semester) !== c.offered) {
        c.semester++;
      }
    }
  }

  // Iteratively fix ordering violations until stable
  let changed = true;
  let iterations = 0;
  while (changed && iterations < 50) {
    changed = false;
    iterations++;
    for (const c of courses) {
      for (const entry of (c.prereqs || [])) {
        const pIds = Array.isArray(entry) ? entry : [entry];
        // For OR groups, we only need one to be before us
        const satisfiedBefore = pIds.some(p => {
          if (!allIds.has(p)) return true; // not in plan = satisfied externally
          return byId[p] && byId[p].semester < c.semester;
        });
        if (!satisfiedBefore) {
          // Find the earliest prereq option's semester
          let minPrereqSem = Infinity;
          for (const p of pIds) {
            if (byId[p]) minPrereqSem = Math.min(minPrereqSem, byId[p].semester);
          }
          if (minPrereqSem < Infinity) {
            let newSem = minPrereqSem + 1;
            if (c.offered && c.offered !== 'Both') {
              while (semSeason(newSem) !== c.offered) newSem++;
            }
            if (newSem !== c.semester) {
              c.semester = newSem;
              changed = true;
            }
          }
        }
      }
    }
  }

  return courses;
}

// ── Semester Rebalancing ─────────────────────────────────────

function rebalanceSemesters(courses) {
  const byId = {};
  for (const c of courses) byId[c.id] = c;
  const allIds = new Set(courses.map(c => c.id));

  // Recompute semester credit totals
  function recalcCredits() {
    const sc = {};
    for (const c of courses) {
      sc[c.semester] = (sc[c.semester] || 0) + c.credits;
    }
    return sc;
  }

  // Check if moving a course to a later semester would violate any dependent's prereqs
  function canMoveTo(course, targetSem) {
    // Offering constraint
    if (course.offered && course.offered !== 'Both' && semSeason(targetSem) !== course.offered) {
      return false;
    }
    // Check no dependent course is in targetSem or earlier
    for (const other of courses) {
      if (other.id === course.id) continue;
      for (const entry of (other.prereqs || [])) {
        const pIds = Array.isArray(entry) ? entry : [entry];
        if (pIds.includes(course.id)) {
          // 'other' depends on 'course' — course must stay before other
          if (targetSem >= other.semester) return false;
        }
      }
    }
    return true;
  }

  // Multiple passes to handle cascading overloads
  for (let pass = 0; pass < 5; pass++) {
    const semCredits = recalcCredits();
    let anyMoved = false;

    const overloadedSems = Object.entries(semCredits)
      .filter(([_, cr]) => cr > MAX_CREDITS_PER_SEM)
      .map(([s]) => parseInt(s))
      .sort((a, b) => a - b);

    for (const sem of overloadedSems) {
      // Sort: placeholders first, then courses with fewer dependents
      const semCourses = courses
        .filter(c => c.semester === sem)
        .sort((a, b) => {
          if (a.isPlaceholder !== b.isPlaceholder) return a.isPlaceholder ? -1 : 1;
          return 0;
        });

      let currentCredits = semCredits[sem];
      for (const c of semCourses) {
        if (currentCredits <= MAX_CREDITS_PER_SEM) break;

        // Try moving to next few semesters
        for (let targetSem = sem + 1; targetSem <= sem + 4; targetSem++) {
          const targetCredits = semCredits[targetSem] || 0;
          if (targetCredits + c.credits > MAX_CREDITS_PER_SEM) continue;
          if (!canMoveTo(c, targetSem)) continue;

          c.semester = targetSem;
          semCredits[sem] -= c.credits;
          semCredits[targetSem] = targetCredits + c.credits;
          currentCredits -= c.credits;
          anyMoved = true;
          break;
        }
      }
    }

    if (!anyMoved) break;
  }

  return courses;
}

// ── Stats Computation ────────────────────────────────────────

function computeStats(courses, hasSecondary) {
  const sharedCourses = courses.filter(c => c.origin === 'shared');
  const totalCredits = courses.reduce((s, c) => s + c.credits, 0);
  const maxSem = Math.max(...courses.map(c => c.semester), 0);

  // Per-semester credits for overload warnings
  const semCredits = {};
  for (const c of courses) {
    semCredits[c.semester] = (semCredits[c.semester] || 0) + c.credits;
  }
  const overloaded = Object.entries(semCredits)
    .filter(([_, cr]) => cr > MAX_CREDITS_PER_SEM)
    .map(([sem, cr]) => ({ semester: parseInt(sem), credits: cr }));

  return {
    totalCredits,
    semesters: maxSem,
    sharedCount: sharedCourses.length,
    sharedCredits: sharedCourses.reduce((s, c) => s + c.credits, 0),
    overloaded,
    semCredits,
    hasSecondary: !!hasSecondary,
  };
}

// ── Rendering ────────────────────────────────────────────────

function renderPlan(courses, stats) {
  // Show containers
  document.getElementById('planner-stats').style.display = '';
  document.getElementById('planner-area').style.display = '';
  document.getElementById('planner-legend').style.display = '';

  // Stats
  document.getElementById('planner-total-credits').textContent = stats.totalCredits;
  document.getElementById('planner-semesters').textContent = stats.semesters;
  document.getElementById('planner-shared').textContent = stats.sharedCount;
  document.getElementById('planner-shared-credits').textContent = stats.sharedCredits;

  // Show/hide shared stats based on whether there's a secondary
  const sharedStatEls = document.querySelectorAll('#planner-shared, #planner-shared-credits');
  // The parent .planner-stat elements
  sharedStatEls.forEach(el => {
    el.closest('.planner-stat').style.display = stats.hasSecondary ? '' : 'none';
  });

  // Legend items
  const legendSec = document.getElementById('legend-secondary');
  if (legendSec) legendSec.style.display = stats.hasSecondary ? '' : 'none';
  const legendMinor = document.getElementById('legend-minor');
  if (legendMinor) legendMinor.style.display = PLANNER_STATE.selectedMinors.length ? '' : 'none';
  const legendCC = document.getElementById('legend-cc');
  if (legendCC) legendCC.style.display = PLANNER_STATE.ccEnabled ? '' : 'none';

  // Overload warning
  const warning = document.getElementById('planner-warning');
  if (stats.overloaded.length) {
    const semLabels = stats.overloaded.map(o => {
      const { year, season } = getSemLabel(o.semester);
      return season + ', ' + year + ' (' + o.credits + ' cr)';
    });
    warning.innerHTML = '&#9888; Overloaded semesters: ' + semLabels.join('; ');
    warning.style.display = '';
  } else {
    warning.style.display = 'none';
  }

  // Grid
  const grid = document.getElementById('planner-grid');
  grid.innerHTML = '';

  const maxSem = stats.semesters;

  for (let sem = 1; sem <= maxSem; sem++) {
    const semCourses = courses
      .filter(c => c.semester === sem)
      .sort((a, b) => {
        // Non-placeholders first, then by code
        if (a.isPlaceholder !== b.isPlaceholder) return a.isPlaceholder ? 1 : -1;
        return a.code.localeCompare(b.code);
      });

    if (!semCourses.length) continue;

    const { year, season } = getSemLabel(sem);
    const credits = stats.semCredits[sem] || 0;
    const isOverloaded = credits > MAX_CREDITS_PER_SEM;

    const col = document.createElement('div');
    col.className = 'sem-col';

    // Header
    const header = document.createElement('div');
    header.className = 'sem-header';
    header.innerHTML =
      '<div class="sem-year">' + year + '</div>' +
      '<div class="sem-name">' + season + ' &mdash; ' +
        '<span class="' + (isOverloaded ? 'credits-overloaded' : '') + '">' +
          credits + ' cr' +
        '</span>' +
      '</div>';
    col.appendChild(header);

    // Cards
    const cardsWrap = document.createElement('div');
    cardsWrap.className = 'sem-cards';

    for (const course of semCourses) {
      const card = document.createElement('div');
      card.className = 'planner-card origin-' + course.origin;
      card.dataset.id = course.id;
      card.style.cursor = 'pointer';
      card.addEventListener('click', () => openPlannerPanel(course));

      // Tag color stripe
      const tag = (course.tags && course.tags[0]) ? course.tags[0] : null;
      const tagStyle = tag && TAGS[tag] ? TAGS[tag] : null;
      if (tagStyle) {
        card.style.borderLeftColor = tagStyle.bg;
      }

      card.innerHTML =
        '<div class="planner-card-top">' +
          '<span class="planner-code">' + course.code + '</span>' +
          '<span class="planner-origin-dot origin-dot-' + course.origin + '"></span>' +
        '</div>' +
        '<div class="planner-title">' + course.title + '</div>' +
        '<div class="planner-card-bottom">' +
          '<span class="planner-credits">' + course.credits + ' cr</span>' +
        '</div>';

      cardsWrap.appendChild(card);
    }

    col.appendChild(cardsWrap);
    grid.appendChild(col);
  }

  // Overflow — shouldn't happen often but just in case
  const overflow = document.getElementById('planner-overflow');
  const overflowList = document.getElementById('planner-overflow-list');
  const unplaced = courses.filter(c => !c.semester || c.semester < 1);
  if (unplaced.length) {
    overflow.style.display = '';
    overflowList.innerHTML = '';
    for (const c of unplaced) {
      const card = document.createElement('div');
      card.className = 'planner-card origin-' + c.origin;
      card.innerHTML =
        '<div class="planner-card-top"><span class="planner-code">' + c.code + '</span></div>' +
        '<div class="planner-title">' + c.title + '</div>' +
        '<div class="planner-card-bottom"><span class="planner-credits">' + c.credits + ' cr</span></div>';
      overflowList.appendChild(card);
    }
  } else {
    overflow.style.display = 'none';
  }
}

// ── Detail Panel ─────────────────────────────────────────────

function openPlannerPanel(course) {
  PLANNER_STATE.selected = course;

  // Highlight selected card
  document.querySelectorAll('.planner-card').forEach(c => c.classList.remove('selected'));
  const card = document.querySelector('.planner-card[data-id="' + course.id + '"]');
  if (card) card.classList.add('selected');

  const panel = document.getElementById('planner-detail-panel');
  panel.classList.add('open');

  document.getElementById('planner-panel-code').textContent = course.code;
  document.getElementById('planner-panel-title').textContent = course.title;
  document.getElementById('planner-panel-credits').textContent = course.credits + ' credits';

  // Origin label
  const originLabels = {
    shared: 'Required by both programs',
    primary: 'Primary program only',
    secondary: 'Secondary program only',
    minor: 'Minor requirement',
    cc: 'Christ College Scholar',
  };
  document.getElementById('planner-panel-origin').textContent = originLabels[course.origin] || '';

  document.getElementById('planner-panel-desc').textContent = course.desc || 'No description available.';

  // Prereqs
  const prereqEl = document.getElementById('planner-panel-prereqs');
  prereqEl.innerHTML = '';
  if (course.prereqs && course.prereqs.length) {
    for (const entry of course.prereqs) {
      const pIds = Array.isArray(entry) ? entry : [entry];
      const labels = pIds.map(p => {
        const pc = COURSES[p];
        return pc ? pc.code : p;
      });
      const span = document.createElement('span');
      span.className = 'rel-chip';
      span.textContent = labels.join(' or ');
      prereqEl.appendChild(span);
    }
  } else {
    prereqEl.textContent = 'None';
  }

  // Coreqs
  const coreqEl = document.getElementById('planner-panel-coreqs');
  coreqEl.innerHTML = '';
  if (course.coreqs && course.coreqs.length) {
    for (const co of course.coreqs) {
      const cc = COURSES[co];
      const span = document.createElement('span');
      span.className = 'rel-chip';
      span.textContent = cc ? cc.code : co;
      coreqEl.appendChild(span);
    }
  } else {
    coreqEl.textContent = 'None';
  }
}

function closePlannerPanel() {
  PLANNER_STATE.selected = null;
  document.getElementById('planner-detail-panel').classList.remove('open');
  document.querySelectorAll('.planner-card').forEach(c => c.classList.remove('selected'));
}

// ── Click-off & keyboard ─────────────────────────────────────
document.getElementById('planner-area')?.addEventListener('click', ev => {
  if (ev.target.closest('.planner-card')) return;
  if (PLANNER_STATE.selected) closePlannerPanel();
});
document.addEventListener('keydown', ev => {
  if (ev.key === 'Escape' && PLANNER_STATE.selected) closePlannerPanel();
});

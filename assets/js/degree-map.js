// ╔══════════════════════════════════════════════════════════════╗
// ║  DEGREE MAP — Rendering & Interaction Logic                  ║
// ║                                                              ║
// ║  Expects these globals (injected by degree-map.html layout): ║
// ║    TAGS      — { key: { label, bg, fg } }                    ║
// ║    SEMESTERS — [ { s, year, season }, … ]                    ║
// ║    COURSES   — { id: { id, code, title, … }, … }            ║
// ╚══════════════════════════════════════════════════════════════╝

// ── BUILD UNLOCK INDEX (derived — do not edit manually) ────────
const UNLOCKS = {};
for (const c of Object.values(COURSES)) {
  if (!UNLOCKS[c.id]) UNLOCKS[c.id] = [];
  for (const pid of (c.prereqs || [])) {
    if (!UNLOCKS[pid]) UNLOCKS[pid] = [];
    if (!UNLOCKS[pid].includes(c.id)) UNLOCKS[pid].push(c.id);
  }
  for (const cid of (c.coreqs || [])) {
    if (!UNLOCKS[cid]) UNLOCKS[cid] = [];
    if (!UNLOCKS[cid].includes(c.id)) UNLOCKS[cid].push(c.id);
  }
}


// ╔══════════════════════════════════════════════════════════════╗
// ║  APPLICATION STATE                                           ║
// ╚══════════════════════════════════════════════════════════════╝
let STATE = {
  program:  "ME",
  track:    "BE_Biomech",
  selected: null,
  tag:      null,
};

function currentProg() {
  return STATE.program === "ME" ? "ME" : STATE.track;
}


// ╔══════════════════════════════════════════════════════════════╗
// ║  TAG FILTER BAR                                              ║
// ╚══════════════════════════════════════════════════════════════╝
function buildTagBar() {
  const bar = document.getElementById("tag-bar");
  bar.innerHTML = '<span class="tag-bar-label">Filter:</span>';

  const allBtn = document.createElement("button");
  allBtn.className = "tag-filter-btn active";
  allBtn.textContent = "All";
  allBtn.style.cssText = "background:#5C3000; color:#FFE300;";
  allBtn.dataset.tag = "all";
  allBtn.onclick = () => filterByTag("all", allBtn);
  bar.appendChild(allBtn);

  for (const [key, def] of Object.entries(TAGS)) {
    const btn = document.createElement("button");
    btn.className = "tag-filter-btn";
    btn.textContent = def.label;
    btn.style.cssText = `background:${def.bg}; color:${def.fg};`;
    btn.dataset.tag = key;
    btn.onclick = () => filterByTag(key, btn);
    bar.appendChild(btn);
  }
}


// ╔══════════════════════════════════════════════════════════════╗
// ║  RENDER                                                      ║
// ╚══════════════════════════════════════════════════════════════╝
function render() {
  const prog = currentProg();
  const fc  = document.getElementById("flowchart");
  const svg = document.getElementById("arrow-svg");
  fc.innerHTML = "";
  fc.appendChild(svg);

  SEMESTERS.forEach(({ s, year, season }) => {
    const courses = Object.values(COURSES).filter(c => c.semesters && c.semesters[prog] === s);
    if (!courses.length) return;

    const totalCr = courses.reduce((sum, c) => sum + c.credits, 0);

    const col = document.createElement("div");
    col.className = "sem-col";
    col.dataset.sem = s;
    col.innerHTML = `
      <div class="sem-header">
        <div class="sem-year">${year}</div>
        <div class="sem-name">${season} &middot; Sem ${s}</div>
        <div class="sem-total">${totalCr.toFixed(1)} cr</div>
      </div>
      <div class="sem-cards" id="sc${s}"></div>`;
    fc.appendChild(col);

    const cardsEl = col.querySelector(`#sc${s}`);
    courses.forEach(c => cardsEl.appendChild(makeCard(c)));
  });

  if (STATE.tag && STATE.tag !== "all") filterByTag(STATE.tag, null, true);
  setTimeout(drawArrows, 80);
}

function makeCard(course) {
  const el = document.createElement("div");
  el.className = "course-card" + (course.isPlaceholder ? " is-placeholder" : "");
  el.id = "card-" + course.id;
  el.dataset.id = course.id;

  const tagChips = (course.tags || []).map(t => {
    const def = TAGS[t];
    if (!def) return "";
    return `<span class="card-tag" style="background:${def.bg};color:${def.fg}">${def.label}</span>`;
  }).join("");

  el.innerHTML = `
    <span class="credit-badge">${course.credits} cr</span>
    <div class="card-code">${course.code}</div>
    <div class="card-title">${course.title}</div>
    <div class="card-tags">${tagChips}</div>`;

  // Expandable elective list
  if (course.isPlaceholder && course.eligible && course.eligible.length) {
    const list = document.createElement("div");
    list.className = "eligible-list";
    list.id = "el-" + course.id;
    course.eligible.forEach(e => {
      const item = document.createElement("div");
      item.className = "eligible-item";
      item.textContent = e;
      list.appendChild(item);
    });

    const btn = document.createElement("button");
    btn.className = "expand-btn";
    btn.textContent = "\u25be show eligible courses";
    btn.onclick = ev => {
      ev.stopPropagation();
      const open = list.classList.toggle("open");
      btn.textContent = open ? "\u25b4 hide eligible courses" : "\u25be show eligible courses";
    };

    el.appendChild(btn);
    el.appendChild(list);
  }

  el.onclick = () => selectCourse(course.id);
  return el;
}


// ╔══════════════════════════════════════════════════════════════╗
// ║  COURSE SELECTION & HIGHLIGHTING                             ║
// ╚══════════════════════════════════════════════════════════════╝
function selectCourse(id) {
  if (STATE.selected === id) { clearSelection(); return; }
  STATE.selected = id;

  const course = COURSES[id];
  if (!course) return;

  const prog    = currentProg();
  const prereqs = new Set(course.prereqs || []);
  const coreqs  = new Set(course.coreqs  || []);
  const unlocks = new Set(
    (UNLOCKS[id] || []).filter(x => COURSES[x] && COURSES[x].semesters && COURSES[x].semesters[prog])
  );

  document.querySelectorAll(".course-card").forEach(el => {
    const cid = el.dataset.id;
    el.classList.remove("state-selected","state-prereq","state-coreq","state-unlocked","state-dimmed","state-tag-match");
    if      (cid === id)         el.classList.add("state-selected");
    else if (prereqs.has(cid))   el.classList.add("state-prereq");
    else if (coreqs.has(cid))    el.classList.add("state-coreq");
    else if (unlocks.has(cid))   el.classList.add("state-unlocked");
    else                         el.classList.add("state-dimmed");
  });

  highlightArrows(id, prereqs, coreqs, unlocks);
  openPanel(course, prereqs, coreqs, unlocks);
}

function clearSelection() {
  STATE.selected = null;
  document.querySelectorAll(".course-card").forEach(el =>
    el.classList.remove("state-selected","state-prereq","state-coreq","state-unlocked","state-dimmed")
  );
  document.querySelectorAll("#arrow-svg path").forEach(p => {
    p.classList.remove("hi-prereq","hi-unlocked","hi-coreq","fade");
    p.setAttribute("marker-end", p.dataset.type === "prereq" ? "url(#mPre)" : "url(#mCo)");
  });
  document.getElementById("detail-panel").classList.remove("open");
  if (STATE.tag && STATE.tag !== "all") filterByTag(STATE.tag, null, true);
}


// ╔══════════════════════════════════════════════════════════════╗
// ║  TAG FILTERING                                               ║
// ╚══════════════════════════════════════════════════════════════╝
function filterByTag(tag, btn, silent = false) {
  STATE.tag = tag;

  if (!silent) {
    document.querySelectorAll(".tag-filter-btn").forEach(b => b.classList.remove("active"));
    if (btn) {
      btn.classList.add("active");
    } else {
      const match = document.querySelector(`[data-tag="${tag}"]`);
      if (match) match.classList.add("active");
    }
  }

  if (tag === "all") {
    document.querySelectorAll(".course-card").forEach(el =>
      el.classList.remove("state-dimmed","state-tag-match")
    );
    return;
  }

  document.querySelectorAll(".course-card").forEach(el => {
    const c = COURSES[el.dataset.id];
    if (!c) return;
    el.classList.remove("state-dimmed","state-tag-match","state-selected","state-prereq","state-coreq","state-unlocked");
    if (c.tags && c.tags.includes(tag)) {
      el.classList.add("state-tag-match");
    } else {
      el.classList.add("state-dimmed");
    }
  });
}


// ╔══════════════════════════════════════════════════════════════╗
// ║  ARROW DRAWING                                               ║
// ╚══════════════════════════════════════════════════════════════╝
function drawArrows() {
  const svg = document.getElementById("arrow-svg");
  svg.querySelectorAll("path").forEach(p => p.remove());

  const prog = currentProg();
  const mainArea = document.getElementById("main-area");
  const mr = mainArea.getBoundingClientRect();
  const sl = mainArea.scrollLeft;
  const st = mainArea.scrollTop;

  function cardPos(id) {
    const el = document.getElementById("card-" + id);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      cx: r.left - mr.left + sl + r.width  / 2,
      cy: r.top  - mr.top  + st + r.height / 2,
      rx: r.right  - mr.left + sl,
      lx: r.left   - mr.left + sl,
      ty: r.top    - mr.top  + st,
      by: r.bottom - mr.top  + st,
    };
  }

  const drawn = new Set();

  for (const course of Object.values(COURSES)) {
    if (!course.semesters || !course.semesters[prog]) continue;
    const toPos = cardPos(course.id);
    if (!toPos) continue;

    // Prereq arrows
    for (const pid of (course.prereqs || [])) {
      if (!COURSES[pid] || !COURSES[pid].semesters || !COURSES[pid].semesters[prog]) continue;
      const key = pid + "->" + course.id;
      if (drawn.has(key)) continue;
      drawn.add(key);
      const fromPos = cardPos(pid);
      if (!fromPos) continue;
      svg.appendChild(makePath(fromPos, toPos, false, pid, course.id));
    }

    // Coreq arrows
    for (const cid of (course.coreqs || [])) {
      if (!COURSES[cid] || !COURSES[cid].semesters || !COURSES[cid].semesters[prog]) continue;
      const key = "co:" + [cid, course.id].sort().join("-");
      if (drawn.has(key)) continue;
      drawn.add(key);
      const fromPos = cardPos(cid);
      if (!fromPos) continue;
      svg.appendChild(makePath(fromPos, toPos, true, cid, course.id));
    }
  }
}

function makePath(from, to, isCoreq, fromId, toId) {
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.classList.add(isCoreq ? "arrow-coreq" : "arrow-prereq");
  p.dataset.from = fromId;
  p.dataset.to   = toId;
  p.dataset.type = isCoreq ? "coreq" : "prereq";

  const SAME_COL_THRESHOLD = 100;
  const sameCol = Math.abs(from.cx - to.cx) < SAME_COL_THRESHOLD;
  let d;

  if (sameCol) {
    const bulge = Math.max(from.rx, to.rx) + 38;
    d = `M ${from.rx} ${from.cy} C ${bulge} ${from.cy} ${bulge} ${to.cy} ${to.rx} ${to.cy}`;
  } else if (from.cx < to.cx) {
    const dx = to.cx - from.cx;
    const c1x = from.rx + dx * 0.4;
    const c2x = to.lx   - dx * 0.4;
    d = `M ${from.rx} ${from.cy} C ${c1x} ${from.cy} ${c2x} ${to.cy} ${to.lx} ${to.cy}`;
  } else {
    const dx = from.cx - to.cx;
    const c1x = from.lx - dx * 0.4;
    const c2x = to.rx   + dx * 0.4;
    d = `M ${from.lx} ${from.cy} C ${c1x} ${from.cy} ${c2x} ${to.cy} ${to.rx} ${to.cy}`;
  }

  p.setAttribute("d", d);
  p.setAttribute("marker-end", isCoreq ? "url(#mCo)" : "url(#mPre)");

  // Arrow tooltip
  p.style.pointerEvents = "stroke";
  p.addEventListener("mouseenter", ev => {
    const tip = document.getElementById("tooltip");
    const fc  = COURSES[fromId];
    const tc  = COURSES[toId];
    tip.textContent = `${fc ? fc.code : fromId} → ${tc ? tc.code : toId} (${isCoreq ? "co-req" : "prereq"})`;
    tip.style.left = (ev.clientX + 10) + "px";
    tip.style.top  = (ev.clientY - 28) + "px";
    tip.classList.add("vis");
  });
  p.addEventListener("mouseleave", () => document.getElementById("tooltip").classList.remove("vis"));

  return p;
}

function highlightArrows(selId, prereqs, coreqs, unlocks) {
  document.querySelectorAll("#arrow-svg path").forEach(p => {
    const f  = p.dataset.from;
    const t  = p.dataset.to;
    const ty = p.dataset.type;
    p.classList.remove("hi-prereq","hi-unlocked","hi-coreq","fade");

    if (ty === "prereq") {
      if (t === selId && prereqs.has(f)) {
        p.classList.add("hi-prereq");  p.setAttribute("marker-end","url(#mPreHi)");
      } else if (f === selId && unlocks.has(t)) {
        p.classList.add("hi-unlocked"); p.setAttribute("marker-end","url(#mUnHi)");
      } else {
        p.classList.add("fade");        p.setAttribute("marker-end","url(#mPre)");
      }
    } else {
      if ((f === selId && coreqs.has(t)) || (t === selId && coreqs.has(f))) {
        p.classList.add("hi-coreq");   p.setAttribute("marker-end","url(#mCoHi)");
      } else {
        p.classList.add("fade");        p.setAttribute("marker-end","url(#mCo)");
      }
    }
  });
}


// ╔══════════════════════════════════════════════════════════════╗
// ║  DETAIL PANEL                                                ║
// ╚══════════════════════════════════════════════════════════════╝
function openPanel(course, prereqs, coreqs, unlocks) {
  document.getElementById("panel-code").textContent    = course.code;
  document.getElementById("panel-title").textContent   = course.title;
  document.getElementById("panel-credits").textContent = course.credits + " credits";

  document.getElementById("panel-tags").innerHTML = (course.tags || []).map(t => {
    const def = TAGS[t];
    if (!def) return "";
    return `<span class="card-tag" style="background:${def.bg};color:${def.fg};font-size:.65rem;padding:.15rem .5rem">${def.label}</span>`;
  }).join("");

  document.getElementById("panel-desc").textContent = course.desc || "";

  function renderPills(ids, cssClass, elId) {
    const el = document.getElementById(elId);
    el.innerHTML = "";
    const arr = [...ids].filter(id => COURSES[id]);
    if (!arr.length) { el.innerHTML = '<span class="none-label">none</span>'; return; }
    arr.forEach(id => {
      const rc = COURSES[id];
      const sp = document.createElement("span");
      sp.className = "rel-pill " + cssClass;
      sp.textContent = rc.code;
      sp.title = rc.title;
      sp.onclick = () => selectCourse(id);
      el.appendChild(sp);
    });
  }

  renderPills(prereqs, "prereq-pill", "panel-prereqs");
  renderPills(coreqs,  "coreq-pill",  "panel-coreqs");
  renderPills(unlocks, "unlock-pill",  "panel-unlocked");

  const eligibleEl = document.getElementById("panel-eligible");
  if (course.isPlaceholder && course.eligible && course.eligible.length) {
    eligibleEl.innerHTML = `
      <h5>Eligible Courses</h5>
      <div class="eligible-panel-list">
        ${course.eligible.map(e => `<div class="eligible-panel-item">${e}</div>`).join("")}
      </div>`;
  } else {
    eligibleEl.innerHTML = "";
  }

  document.getElementById("detail-panel").classList.add("open");
}


// ╔══════════════════════════════════════════════════════════════╗
// ║  PROGRAM / TRACK SWITCHING                                   ║
// ╚══════════════════════════════════════════════════════════════╝
function setProgram(prog, btn) {
  STATE.program  = prog;
  STATE.selected = null;
  STATE.tag      = null;
  document.getElementById("detail-panel").classList.remove("open");
  document.querySelectorAll(".prog-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  document.getElementById("track-selector").classList.toggle("visible", prog === "BE");
  document.querySelectorAll(".tag-filter-btn").forEach(b => b.classList.remove("active"));
  document.querySelector("[data-tag='all']").classList.add("active");
  render();
}

function setTrack(track, btn) {
  STATE.track    = track;
  STATE.selected = null;
  document.getElementById("detail-panel").classList.remove("open");
  document.querySelectorAll(".track-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  render();
}


// ╔══════════════════════════════════════════════════════════════╗
// ║  WINDOW EVENTS                                               ║
// ╚══════════════════════════════════════════════════════════════╝
let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(drawArrows, 150);
});
document.getElementById("main-area").addEventListener("scroll", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(drawArrows, 60);
});


// ╔══════════════════════════════════════════════════════════════╗
// ║  ZOOM CONTROLS                                                ║
// ╚══════════════════════════════════════════════════════════════╝
let zoomLevel = 1.0;
const ZOOM_MIN = 0.5, ZOOM_MAX = 1.5, ZOOM_STEP = 0.1;

function applyZoom() {
  const fc      = document.getElementById("flowchart");
  const wrapper = document.getElementById("flowchart-wrapper");
  fc.style.transform = `scale(${zoomLevel})`;
  requestAnimationFrame(() => {
    wrapper.style.width  = (fc.scrollWidth  * zoomLevel) + "px";
    wrapper.style.height = (fc.scrollHeight * zoomLevel) + "px";
  });
  document.getElementById("zoom-level").textContent = Math.round(zoomLevel * 100) + "%";
}

function zoomIn()  { zoomLevel = Math.min(ZOOM_MAX, +(zoomLevel + ZOOM_STEP).toFixed(1)); applyZoom(); }
function zoomOut() { zoomLevel = Math.max(ZOOM_MIN, +(zoomLevel - ZOOM_STEP).toFixed(1)); applyZoom(); }


// ── INIT ──────────────────────────────────────────────────────
buildTagBar();
render();
applyZoom();

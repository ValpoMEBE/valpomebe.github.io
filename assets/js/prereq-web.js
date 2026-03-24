/* ╔══════════════════════════════════════════════════════════════╗
   ║  PREREQUISITE WEB — Live Physics Simulation                 ║
   ║  Neural-network-style interactive web with draggable nodes  ║
   ╚══════════════════════════════════════════════════════════════╝ */

/* ── CONFIG ──────────────────────────────────────────────────── */
const NODE_W  = 80;
const NODE_H  = 30;
const PAD     = 60;
const DISC_COL_W = 120;
const DISC_GAP   = 4;

/* Physics tuning */
const DEPTH_SPACING = 160;
const REPULSION     = 30000;
const SPRING_K      = 0.006;
const SPRING_REST   = 120;     // natural spring length
const COREQ_K       = 0.008;
const GRAVITY_Y     = 0.04;
const CENTER_X_K    = 0.0008;
const DAMPING       = 0.88;
const MAX_VEL       = 8;

/* ── STATE ───────────────────────────────────────────────────── */
let currentProgram = 'MEBE';
let nodes = {};        // id → {x, y, vx, vy, targetY, fixed}
let graphData = null;  // current graph (children, parents, coEdges, etc.)
let disconnectedIds = [];
let connectedIds = new Set();
let animRunning = false;
let dragId = null;     // currently dragged node
let dragOffX = 0, dragOffY = 0;

/* Pan & zoom state */
let panX = 0, panY = 0;
let svgW = 2000, svgH = 1200;
let vw = svgW, vh = svgH;
let isPanning = false, panStartX = 0, panStartY = 0, panStartPX = 0, panStartPY = 0;

const svg       = document.getElementById('pw-svg');
const container = document.getElementById('pw-container');
const tooltip   = document.getElementById('pw-tooltip');

/* ── PROGRAM FILTER ──────────────────────────────────────────── */
function pwSetProgram(prog, btn) {
  currentProgram = prog;
  document.querySelectorAll('.pw-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  initGraph();
}

/* ── COURSE FILTERING ────────────────────────────────────────── */
function getVisibleIds(prog) {
  const ids = new Set();
  const groups = {
    MEBE:  ['ME', 'BE_Biomech', 'BE_Bioelec', 'BE_Biomed'],
    EECPE: ['EE', 'CPE'],
    CEENE: ['CE', 'ENE']
  };
  const progs = groups[prog] || [prog];
  for (const p of progs) {
    const map = _CURRICULUM[p];
    if (map) for (const cid of Object.keys(map)) { if (!cid.startsWith('_')) ids.add(cid); }
  }
  return ids;
}

/* ── GRAPH BUILDING ──────────────────────────────────────────── */
// Flatten OR prereq/coreq entries: arrays become individual IDs
function _flatReqs(reqs) {
  const out = [];
  for (const entry of (reqs || [])) {
    if (Array.isArray(entry)) entry.forEach(id => out.push(id));
    else out.push(entry);
  }
  return out;
}
function buildGraph(visibleIds) {
  const children = {}, parents = {}, coEdges = [], indeg = {}, outdeg = {};
  for (const id of visibleIds) { children[id] = []; parents[id] = []; indeg[id] = 0; outdeg[id] = 0; }
  for (const id of visibleIds) {
    const c = COURSES[id]; if (!c) continue;
    _flatReqs(c.prereqs).forEach(pid => {
      if (visibleIds.has(pid)) { children[pid].push(id); parents[id].push(pid); indeg[id]++; outdeg[pid]++; }
    });
    _flatReqs(c.coreqs).forEach(cid => {
      if (visibleIds.has(cid)) {
        if (!coEdges.some(e => (e.from === cid && e.to === id) || (e.from === id && e.to === cid)))
          coEdges.push({ from: cid, to: id });
      }
    });
  }
  return { children, parents, coEdges, indeg, outdeg };
}

/* ── DEPTH + COMPONENTS ──────────────────────────────────────── */
function assignDepths(ids, graph) {
  const depth = {}, inDeg = {};
  for (const id of ids) { inDeg[id] = 0; depth[id] = 0; }
  for (const id of ids) {
    (graph.parents[id] || []).forEach(pid => { if (ids.has(pid)) inDeg[id]++; });
  }
  const queue = [];
  for (const id of ids) { if (inDeg[id] === 0) queue.push(id); }
  while (queue.length) {
    const id = queue.shift();
    (graph.children[id] || []).forEach(cid => {
      if (!ids.has(cid)) return;
      depth[cid] = Math.max(depth[cid], depth[id] + 1);
      if (--inDeg[cid] === 0) queue.push(cid);
    });
  }
  return depth;
}

function separateDisconnected(visibleIds, graph) {
  const connected = new Set(), disconnected = [];
  for (const id of visibleIds) {
    const has = (graph.indeg[id] > 0 || graph.outdeg[id] > 0 ||
                 graph.coEdges.some(e => e.from === id || e.to === id));
    if (has) connected.add(id); else disconnected.push(id);
  }
  disconnected.sort((a, b) => {
    const ap = COURSES[a]?.isPlaceholder ? 1 : 0, bp = COURSES[b]?.isPlaceholder ? 1 : 0;
    return ap !== bp ? ap - bp : a.localeCompare(b);
  });
  return { connected, disconnected };
}

/* ── INIT GRAPH ──────────────────────────────────────────────── */
function initGraph() {
  const visibleIds = getVisibleIds(currentProgram);
  graphData = buildGraph(visibleIds);
  const sep = separateDisconnected(visibleIds, graphData);
  connectedIds = sep.connected;
  disconnectedIds = sep.disconnected;

  const depth = assignDepths(connectedIds, graphData);

  // Seeded random
  let seed = 77;
  function rand() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }

  // Count nodes per depth for initial spread
  const depthCounts = {}, depthIdx = {};
  for (const id of connectedIds) {
    const d = depth[id];
    depthCounts[d] = (depthCounts[d] || 0) + 1;
  }

  nodes = {};
  const graphLeft = disconnectedIds.length > 0 ? PAD + DISC_COL_W + 30 : PAD;

  // Connected nodes: scatter by depth
  for (const id of connectedIds) {
    const d = depth[id];
    if (!depthIdx[d]) depthIdx[d] = 0;
    const count = depthCounts[d];
    const spread = Math.max(count * (NODE_W + 40), 400);
    const xOff = (depthIdx[d] - (count - 1) / 2) * (NODE_W + 40);
    nodes[id] = {
      x: graphLeft + spread / 2 + xOff + (rand() - 0.5) * 80,
      y: PAD + d * DEPTH_SPACING + (rand() - 0.5) * 60,
      vx: 0, vy: 0,
      targetY: PAD + d * DEPTH_SPACING,
      fixed: false
    };
    depthIdx[d]++;
  }

  // Disconnected nodes: static column on left
  disconnectedIds.forEach((id, i) => {
    nodes[id] = {
      x: PAD, y: PAD + i * (NODE_H + DISC_GAP),
      vx: 0, vy: 0, targetY: PAD + i * (NODE_H + DISC_GAP), fixed: true
    };
  });

  // Compute canvas bounds and render
  updateCanvasSize();
  renderStaticParts();
  renderEdges();

  // Start or restart animation
  settled = false;
  frameCount = 0;
  if (!animRunning) { animRunning = true; animate(); }
}

function updateCanvasSize() {
  let maxX = 0, maxY = 0;
  for (const n of Object.values(nodes)) {
    if (n.x + NODE_W > maxX) maxX = n.x + NODE_W;
    if (n.y + NODE_H > maxY) maxY = n.y + NODE_H;
  }
  svgW = Math.max(maxX + PAD, 800);
  svgH = Math.max(maxY + PAD, 600);
}

/* ── PHYSICS STEP ────────────────────────────────────────────── */
function physicsStep() {
  const ids = [...connectedIds];
  const n = ids.length;
  if (n === 0) return false;

  const fx = {}, fy = {};
  ids.forEach(id => { fx[id] = 0; fy[id] = 0; });

  // 1. Repulsion (all pairs)
  for (let i = 0; i < n; i++) {
    const a = ids[i], na = nodes[a];
    for (let j = i + 1; j < n; j++) {
      const b = ids[j], nb = nodes[b];
      let dx = na.x - nb.x, dy = na.y - nb.y;
      let dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; dist = 1; }
      if (dist > 600) continue;
      const force = REPULSION / (dist * dist);
      const fxv = (dx / dist) * force, fyv = (dy / dist) * force;
      fx[a] += fxv; fy[a] += fyv;
      fx[b] -= fxv; fy[b] -= fyv;
    }
  }

  // 2. Edge springs (prereqs)
  for (const id of ids) {
    (graphData.parents[id] || []).forEach(pid => {
      if (!connectedIds.has(pid)) return;
      const dx = nodes[id].x - nodes[pid].x;
      const dy = nodes[id].y - nodes[pid].y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = SPRING_K * (dist - SPRING_REST);
      const fxv = (dx / dist) * force, fyv = (dy / dist) * force;
      fx[pid] += fxv; fy[pid] += fyv;
      fx[id]  -= fxv; fy[id]  -= fyv;
    });
  }

  // 3. Coreq alignment
  graphData.coEdges.forEach(e => {
    if (!nodes[e.from] || !nodes[e.to]) return;
    const dy = nodes[e.to].y - nodes[e.from].y;
    fy[e.from] += COREQ_K * dy;
    fy[e.to]   -= COREQ_K * dy;
  });

  // 4. Vertical gravity toward depth target
  ids.forEach(id => {
    fy[id] += GRAVITY_Y * (nodes[id].targetY - nodes[id].y);
  });

  // 5. Horizontal centering
  let avgX = 0;
  ids.forEach(id => { avgX += nodes[id].x; });
  avgX /= n;
  ids.forEach(id => {
    fx[id] += CENTER_X_K * (avgX - nodes[id].x);
  });

  // 6. Apply forces
  let totalMovement = 0;
  ids.forEach(id => {
    const nd = nodes[id];
    if (nd.fixed) return;
    nd.vx = (nd.vx + fx[id]) * DAMPING;
    nd.vy = (nd.vy + fy[id]) * DAMPING;
    const v = Math.sqrt(nd.vx * nd.vx + nd.vy * nd.vy);
    if (v > MAX_VEL) { nd.vx *= MAX_VEL / v; nd.vy *= MAX_VEL / v; }
    nd.x += nd.vx;
    nd.y += nd.vy;
    // Wall: don't cross left past the disconnected column separator
    const wallX = disconnectedIds.length > 0 ? PAD + DISC_COL_W + 20 : PAD;
    if (nd.x < wallX) { nd.x = wallX; nd.vx = Math.abs(nd.vx) * 0.3; }
    totalMovement += Math.abs(nd.vx) + Math.abs(nd.vy);
  });

  return totalMovement > 2; // still moving?
}

/* ── ANIMATION LOOP ──────────────────────────────────────────── */
let settled = false;
let frameCount = 0;

function animate() {
  if (!animRunning) return;

  const moving = physicsStep();
  frameCount++;

  // Always render while dragging; otherwise throttle when settled
  if (dragId || moving || !settled || frameCount % 30 === 0) {
    updateNodePositions();
    renderEdges();
    settled = !moving && !dragId;
  }

  // Update canvas size periodically
  if (frameCount % 60 === 0) updateCanvasSize();

  requestAnimationFrame(animate);
}

/* ── SVG RENDERING ───────────────────────────────────────────── */
function luminance(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const toLinear = c => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function getNodeColor(course) {
  if (!course?.tags?.length) return { bg: '#F9F2E3', fg: '#331A00' };
  const tag = TAGS[course.tags[0]];
  if (!tag) return { bg: '#F9F2E3', fg: '#331A00' };
  // Pick dark or light text based on background luminance
  const lum = luminance(tag.bg);
  const fg = lum > 0.35 ? '#1a0e00' : '#FFFFFF';
  return { bg: tag.bg, fg };
}

function truncate(str, max) {
  return !str ? '' : str.length > max ? str.substring(0, max - 1) + '\u2026' : str;
}

function createSVGEl(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

/* Render static parts: defs, separator, column header */
function renderStaticParts() {
  const defs = svg.querySelector('defs');
  svg.innerHTML = '';
  svg.appendChild(defs);

  // Edge layer
  const edgeG = createSVGEl('g', { id: 'pw-edge-layer' });
  svg.appendChild(edgeG);

  // Node layer
  const nodeG = createSVGEl('g', { id: 'pw-node-layer' });
  svg.appendChild(nodeG);

  // Disconnected separator
  if (disconnectedIds.length > 0) {
    const sepX = PAD + DISC_COL_W + 12;
    svg.appendChild(createSVGEl('line', {
      x1: sepX, y1: PAD - 10, x2: sepX, y2: svgH,
      stroke: 'rgba(245,184,10,.15)', 'stroke-width': 1, 'stroke-dasharray': '6,4'
    }));
    const header = createSVGEl('text', {
      x: PAD, y: PAD - 14,
      fill: 'rgba(245,184,10,.5)', 'font-size': '9', 'font-weight': '600',
      'letter-spacing': '.08em', 'font-family': 'var(--font-mono)'
    });
    header.textContent = 'Standalone / Electives';
    svg.appendChild(header);
  }

  // Create node groups
  const allIds = [...connectedIds, ...disconnectedIds];
  for (const id of allIds) {
    const c = COURSES[id]; if (!c) continue;
    const nd = nodes[id]; if (!nd) continue;
    const color = getNodeColor(c);
    const isPlaceholder = c.isPlaceholder;

    const isDisc = nd.fixed;  // disconnected nodes are fixed
    const w = isDisc ? DISC_COL_W : NODE_W;
    const h = NODE_H;

    const g = createSVGEl('g', {
      class: 'pw-node' + (isPlaceholder ? ' placeholder' : '') + (isDisc ? '' : ' draggable'),
      'data-id': id,
      transform: `translate(${nd.x},${nd.y})`
    });

    g.appendChild(createSVGEl('rect', {
      width: w, height: h, rx: 4, ry: 4,
      fill: isPlaceholder ? 'rgba(245,184,10,.08)' : color.bg,
      stroke: isPlaceholder ? 'rgba(245,184,10,.35)' : 'rgba(0,0,0,.12)',
      'stroke-width': isPlaceholder ? 1.5 : 1,
      'stroke-dasharray': isPlaceholder ? '4,2' : 'none'
    }));

    // Course code only — centered in the box
    const fontSize = isDisc ? '9' : '10';
    const code = createSVGEl('text', {
      x: w / 2, y: h / 2 + 1,
      'text-anchor': 'middle', 'dominant-baseline': 'central',
      fill: isPlaceholder ? 'rgba(245,184,10,.7)' : color.fg,
      'font-size': fontSize, 'font-weight': '700', 'font-family': 'var(--font-mono)'
    });
    code.textContent = c.code || id.replace(/_/g, ' ');
    g.appendChild(code);

    // Hover tooltip: "ME 363 — Machine Design I"
    g.addEventListener('mouseenter', (ev) => {
      tooltip.textContent = `${c.code} — ${c.title}`;
      tooltip.classList.add('vis');
    });
    g.addEventListener('mouseleave', () => tooltip.classList.remove('vis'));

    nodeG.appendChild(g);
  }

  updateViewBox();
}

/* Update node positions (fast — just moves transforms) */
function updateNodePositions() {
  document.querySelectorAll('.pw-node').forEach(g => {
    const id = g.dataset.id;
    const nd = nodes[id];
    if (nd) g.setAttribute('transform', `translate(${nd.x},${nd.y})`);
  });
}

/* Render edges */
function renderEdges() {
  const edgeG = document.getElementById('pw-edge-layer');
  if (!edgeG) return;
  edgeG.innerHTML = '';

  // Prereq edges
  for (const id of connectedIds) {
    (graphData.parents[id] || []).forEach(pid => {
      if (!nodes[pid] || !nodes[id]) return;
      edgeG.appendChild(makeEdge(nodes[pid], nodes[id], 'prereq'));
    });
  }

  // Coreq edges
  graphData.coEdges.forEach(e => {
    if (!nodes[e.from] || !nodes[e.to]) return;
    edgeG.appendChild(makeEdge(nodes[e.from], nodes[e.to], 'coreq'));
  });
}

function makeEdge(from, to, type) {
  const fx = from.x + NODE_W / 2, fy = from.y + NODE_H;
  const tx = to.x + NODE_W / 2,   ty = to.y;

  // If roughly same y, use side connections
  const sameY = Math.abs(from.y - to.y) < NODE_H;
  let d;
  if (sameY) {
    const midY = Math.min(from.y, to.y) - 35;
    d = `M${from.x + NODE_W},${from.y + NODE_H / 2} C${from.x + NODE_W + 40},${midY} ${to.x - 40},${midY} ${to.x},${to.y + NODE_H / 2}`;
  } else {
    const dy = (ty - fy) * 0.35;
    d = `M${fx},${fy} C${fx},${fy + dy} ${tx},${ty - dy} ${tx},${ty}`;
  }

  const marker = type === 'coreq' ? 'url(#pw-mCo)' : 'url(#pw-mPre)';
  return createSVGEl('path', {
    d,
    class: type === 'coreq' ? 'pw-arrow-coreq' : 'pw-arrow-prereq',
    'marker-end': marker
  });
}

/* ── PAN & ZOOM ──────────────────────────────────────────────── */
function updateViewBox() {
  svg.setAttribute('viewBox', `${panX} ${panY} ${vw} ${vh}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  document.getElementById('pw-zoom-level').textContent = Math.round((svgW / vw) * 100) + '%';
}

function pwZoomIn()  { zoomBy(0.8); }
function pwZoomOut() { zoomBy(1.25); }
function zoomBy(factor) {
  const newVw = Math.max(200, Math.min(svgW * 3, vw * factor));
  const newVh = Math.max(200, Math.min(svgH * 3, vh * factor));
  panX += (vw - newVw) / 2;
  panY += (vh - newVh) / 2;
  vw = newVw; vh = newVh;
  updateViewBox();
}
function pwFitView() {
  updateCanvasSize();
  panX = -30; panY = -30;
  vw = svgW + 60; vh = svgH + 60;
  updateViewBox();
}

container.addEventListener('wheel', (e) => {
  e.preventDefault();
  const rect = container.getBoundingClientRect();
  const mx = (e.clientX - rect.left) / rect.width;
  const my = (e.clientY - rect.top) / rect.height;
  const factor = e.deltaY > 0 ? 1.1 : 0.9;
  const newVw = Math.max(200, Math.min(svgW * 3, vw * factor));
  const newVh = Math.max(200, Math.min(svgH * 3, vh * factor));
  panX += (vw - newVw) * mx;
  panY += (vh - newVh) * my;
  vw = newVw; vh = newVh;
  updateViewBox();
}, { passive: false });

/* ── DRAG NODES + PAN ────────────────────────────────────────── */
function svgCoords(clientX, clientY) {
  const rect = container.getBoundingClientRect();
  return {
    x: panX + (clientX - rect.left) / rect.width * vw,
    y: panY + (clientY - rect.top) / rect.height * vh
  };
}

container.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;

  // Check if clicking on a node
  const nodeEl = e.target.closest('.pw-node.draggable');
  if (nodeEl) {
    const id = nodeEl.dataset.id;
    if (nodes[id]) {
      dragId = id;
      nodes[id].fixed = true;
      const pt = svgCoords(e.clientX, e.clientY);
      dragOffX = nodes[id].x - pt.x;
      dragOffY = nodes[id].y - pt.y;
      container.style.cursor = 'grabbing';
      settled = false;
      e.preventDefault();
      return;
    }
  }

  // Otherwise pan
  isPanning = true;
  panStartX = e.clientX;
  panStartY = e.clientY;
  panStartPX = panX;
  panStartPY = panY;
  container.style.cursor = 'grabbing';
});

window.addEventListener('mousemove', (e) => {
  // Update tooltip position
  if (tooltip.classList.contains('vis')) {
    tooltip.style.left = (e.clientX + 14) + 'px';
    tooltip.style.top  = (e.clientY - 30) + 'px';
  }

  if (dragId) {
    const pt = svgCoords(e.clientX, e.clientY);
    nodes[dragId].x = pt.x + dragOffX;
    nodes[dragId].y = pt.y + dragOffY;
    nodes[dragId].vx = 0;
    nodes[dragId].vy = 0;
    settled = false;
    return;
  }

  if (isPanning) {
    const rect = container.getBoundingClientRect();
    const dx = e.clientX - panStartX;
    const dy = e.clientY - panStartY;
    panX = panStartPX - dx * (vw / rect.width);
    panY = panStartPY - dy * (vh / rect.height);
    updateViewBox();
  }
});

window.addEventListener('mouseup', () => {
  if (dragId) {
    nodes[dragId].fixed = false;
    // Give it a little kick so it settles
    nodes[dragId].vx = 0;
    nodes[dragId].vy = 0;
    dragId = null;
  }
  isPanning = false;
  container.style.cursor = '';
});

/* ── KEYBOARD ────────────────────────────────────────────────── */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') tooltip.classList.remove('vis');
});

/* ── INIT ────────────────────────────────────────────────────── */
initGraph();
setTimeout(() => pwFitView(), 100);

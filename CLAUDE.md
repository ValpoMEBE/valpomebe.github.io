# CLAUDE.md — ValpoMEBE

## Project Overview

Static site for the Valparaiso University Mechanical Engineering & Bioengineering department. Hosted on GitHub Pages at `valpomebe.github.io`. Built with Jekyll — no npm, no build tools, no JS frameworks.

## Tech Stack

- **Jekyll** with GitHub Pages (Ruby, Bundler)
- **Vanilla ES6+ JavaScript** — all client-side, no server logic
- **pdf.js v3.11.174** loaded from CDN for transcript PDF parsing
- **CSS custom properties** for Valpo brand colors (`--gold`, `--teal`, `--brown`, etc.)

## Dev Server

The dev config uses `baseurl: "/dev"` so all pages are served at `/dev/...` in development.

```bash
bundle exec jekyll serve --config _config.yml,_config.dev.yml
```

The `.claude/launch.json` is configured for `preview_start` with the `jekyll-dev` server on port 4000.

**Gotcha:** Stale Ruby processes can hold port 4000. Kill with `taskkill //F //IM ruby.exe` if the server won't start.

## File Structure

```
_config.yml              # Production config (baseurl: "")
_config.dev.yml           # Dev overrides (baseurl: "/dev")
_data/
  courses.yml             # THE canonical course catalog — single source of truth
  transcript/             # Approved elective lists (from Undergraduate Catalog 2025-2026)
    me_electives.yml      # ME technical elective approved courses
    be_electives.yml      # BE technical elective approved courses
    humanities.yml         # Approved Humanities courses
    social_sciences.yml    # Approved Social Sciences courses
    cultural_diversity.yml # Approved Cultural Diversity courses
    world_languages.yml    # World Language courses (102+ level)
    theology.yml           # Theology/Religious Studies courses
    professional_electives.yml # ME professional elective approved courses
_includes/
  degree-map/             # Degree map page partials (flowchart, detail-panel, etc.)
  transcript/             # Transcript audit page partials (upload, results)
_layouts/
  degree-map.html         # Injects courses.yml as COURSES global
  transcript.html         # Injects courses.yml + ELECTIVE_DATA globals
_pages/
  curriculum.html         # Degree map page (/curriculum/)
  transcript.html         # Transcript audit page (/transcript/)
assets/
  js/
    degree-map.js         # Degree map rendering, arrows, selection, zoom
    transcript-audit.js   # Audit engine: matching, elective grouping, arrows, panel
    transcript-parser.js  # PDF text extraction, course parsing, retake resolution
  css/
    degree-map.css
    transcript.css
    style.css             # Shared site styles
ReferenceDocuments/
  Undergraduate Catalog 2025-2026.pdf  # Source for all curriculum data
```

## Key Concepts

### courses.yml

The single source of truth for all course data across both the degree map and transcript audit. Each entry has: `id`, `code`, `title`, `credits`, `tags`, `prereqs`, `coreqs`, `semesters` (keyed by program: `ME`, `BE_Biomech`, `BE_Bioelec`, `BE_Biomed`), `desc`, and optionally `isPlaceholder`, `eligible`.

### Elective Groups (Transcript Audit)

Multiple placeholder course slots (e.g., 4× ME Elective) are combined into a single grouped tally card. Defined in `ELECTIVE_GROUPS` in `transcript-audit.js`. Each group has:
- `ids` — placeholder course IDs from courses.yml
- `approvedLists` — keys into `ELECTIVE_DATA` (YAML files)
- `blanketDepts` — entire departments that qualify (e.g., any HIST course)
- `checkWorldLang` — boolean for world language matching

### Data Injection (Liquid → JS)

Layouts use Liquid to inject YAML data as JSON globals:
```html
<script>
  const COURSES = {{ site.data.courses | jsonify }};
  const ELECTIVE_DATA = { me_electives: {{ site.data.transcript.me_electives | jsonify }}, ... };
</script>
```

### Transcript Parser

Client-side PDF parsing using pdf.js. Uses y-coordinate bucketing to reconstruct table rows from position-aware text items. Handles retakes (best passing grade wins), W (withdrawal) exclusion, and code aliasing (e.g., `CORE 110` → `VUE_101`).

### Programs & Tracks

- **ME** — Mechanical Engineering (126 credits, 12cr ME electives, 6cr Hum/SS/RS)
- **BE_Biomech** — Bioengineering Biomechanical (126 credits, 6cr BE electives, 6cr Hum/SS/Theo)
- **BE_Bioelec** — Bioengineering Bioelectrical (126 credits, 6cr BE electives, 6cr Hum/SS/Theo)
- **BE_Biomed** — Bioengineering Biomedical (126 credits, 6cr BE electives, 6cr Hum/SS/Theo)

### Lab Bundling

Lab courses on transcripts are bundled with their lecture course in courses.yml via `CODE_ALIASES`:
- `PHYS 141L` → `PHYS_141` (credits combined)
- `GE 100L` → `GE_100`
- `CHEM 121L` → `CHEM_121`

## Conventions

- No test framework — verify via dev server + browser
- Prefer editing existing files over creating new ones
- All curriculum data comes from `ReferenceDocuments/Undergraduate Catalog 2025-2026.pdf`
- Course IDs use underscores: `MATH_132`, `BE_ELEC_S5_BM`, `ME_HUM_1`
- Placeholder courses have `isPlaceholder: true` and an `eligible` list

## Working with the user
- Ask questions if you have them.

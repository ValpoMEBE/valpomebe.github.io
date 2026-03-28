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
  courses/                # Course catalog — split by subject (me.yml, ge.yml, etc.)
                          #   Each entry: id, code, title, credits, tags, prereqs, coreqs, desc
                          #   Used by: degree map, prereq web, transcript audit matching
  curriculum/             # Per-program semester placements (flat map: course_id → semester)
                          #   Controls which courses appear in a program's degree map/timeline
                          #   Used by: degree map rendering, transcript audit timeline view
    me.yml                # ME semester layout
    be_biomech.yml        # BE Biomechanical semester layout
    be_bioelec.yml        # BE Bioelectrical semester layout
    be_biomed.yml         # BE Biomedical semester layout
    music_ba.yml          # Music BA semester layout (for degree map timeline)
    physics_bs.yml        # Physics BS semester layout
    # Also: ce.yml, cpe.yml, ee.yml, ene.yml, math_bs.yml, cs_bs.yml, chemistry_bs.yml
  major_reqs/             # Requirements definitions for non-engineering majors
                          #   Defines complex requirements (repeatable courses, applied credits,
                          #   track options) that curriculum files can't express
                          #   Used by: transcript audit requirements view, Excel export
    music_ba.yml          # Music BA requirements (musicianship, performance, tracks)
  aliases/                # Course code mappings and department renames
    course_aliases.yml    #   Maps transcript codes to course IDs (lab bundling, honors subs)
    department_renames.yml #   Maps old dept prefixes to new (STAT → DATA)
    world_languages.yml   #   List of world language department codes
  minors/                 # Minor program definitions (15 minors)
                          #   Each: id, name, min_credits, requirements[]
                          #   Used by: transcript minor audit
  cc_scholar.yml          # Christ College Scholar requirements
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
  inject-courses.html     # Shared include: aggregates courses + merges curriculum data
  degree-map/             # Degree map page partials (flowchart, detail-panel, etc.)
  transcript/             # Transcript audit page partials (upload, results)
_layouts/
  degree-map.html         # Degree map layout (uses inject-courses.html)
  transcript.html         # Transcript audit layout (uses inject-courses.html)
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

### courses/ (Course Catalog)

Split by subject into `_data/courses/*.yml`. Each entry has: `id`, `code`, `title`, `credits`, `tags`, `prereqs`, `coreqs`, `desc`, and optionally `isPlaceholder`, `eligible`, `offered`.

### curriculum/ (Semester Placements)

Per-program files in `_data/curriculum/` map course IDs to semester numbers (1–8). Each program has its own file (`me.yml`, `be_biomech.yml`, `be_bioelec.yml`, `be_biomed.yml`). To move a course to a different semester, edit the number in the relevant curriculum file. The shared include `_includes/inject-courses.html` merges these into `COURSES[id].semesters[program]` at build time.

### Elective Groups (Transcript Audit)

Multiple placeholder course slots (e.g., 4× ME Elective) are combined into a single grouped tally card. Defined in `ELECTIVE_GROUPS` in `transcript-audit.js`. Each group has:
- `ids` — placeholder course IDs from courses.yml
- `approvedLists` — keys into `ELECTIVE_DATA` (YAML files)
- `blanketDepts` — entire departments that qualify (e.g., any HIST course)
- `checkWorldLang` — boolean for world language matching

### Data Injection (Liquid → JS)

The shared include `_includes/inject-courses.html` aggregates all course files and merges curriculum semester placements, providing `COURSES_ARRAY` and `COURSES` globals. Layouts add page-specific globals (SEMESTERS, ELECTIVE_DATA, etc.) in separate script blocks.

### Transcript Parser

Client-side PDF parsing using pdf.js. Uses y-coordinate bucketing to reconstruct table rows from position-aware text items. Handles retakes (best passing grade wins), W (withdrawal) exclusion, and code aliasing (e.g., `CORE 110` → `VUE_101`).

### Programs & Tracks

- **ME** — Mechanical Engineering (126 credits, 12cr ME electives, 6cr Hum/SS/RS)
- **BE_Biomech** — Bioengineering Biomechanical (126 credits, 6cr BE electives, 6cr Hum/SS/RS)
- **BE_Bioelec** — Bioengineering Bioelectrical (126 credits, 6cr BE electives, 6cr Hum/SS/RS)
- **BE_Biomed** — Bioengineering Biomedical (126 credits, 6cr BE electives, 6cr Hum/SS/RS)

### Lab Bundling

Lab courses on transcripts are bundled with their lecture course in courses.yml via `CODE_ALIASES`:
- `PHYS 141L` → `PHYS_141` (credits combined)
- `GE 100L` → `GE_100`
- `CHEM 121L` → `CHEM_121`

## Reading the Catalog PDF

The reference document `ReferenceDocuments/Undergraduate Catalog 2025-2026.pdf` (1299 pages) is the source of truth for all curriculum data. The built-in PDF reader does NOT work on Windows (missing `pdftoppm`). Use Python with PyMuPDF (`fitz`) instead:

```python
import fitz
doc = fitz.open('G:/GitHubProjects/valpomebe.github.io/ReferenceDocuments/Undergraduate Catalog 2025-2026.pdf')
# Read specific pages (0-indexed)
page = doc[276]  # page 277
print(page.get_text())
# Search for content
for i in range(doc.page_count):
    if 'Physics, B.S.' in doc[i].get_text():
        print(f'Found on page {i+1}')
        break
```

## Conventions

- No test framework — verify via dev server + browser
- Prefer editing existing files over creating new ones
- All curriculum data comes from `ReferenceDocuments/Undergraduate Catalog 2025-2026.pdf`
- Course IDs use underscores: `MATH_132`, `BE_ELEC_S5_BM`, `ME_HUM_1`
- Placeholder courses have `isPlaceholder: true` and an `eligible` list

## Working with the user
- Ask questions if you have them.

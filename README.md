# ValpoMEBE — Mechanical Engineering & Bioengineering

Interactive degree maps and curriculum tools for the ME and BE programs at Valparaiso University.

**Live site:** https://valpomebe.github.io
**Dev preview:** https://valpomebe.github.io/dev/

## Quick Start

```bash
gem install bundler
bundle install
bundle exec jekyll serve
```

Open http://localhost:4000 to view locally.

## Editing Course Data

All course data lives in `_data/courses.yml`. Each course entry looks like:

```yaml
- id: MATH_131
  code: "MATH 131"
  title: "Calculus I"
  credits: 4
  tags: [math]
  prereqs: []
  coreqs: []
  semesters:
    ME: 1
    BE_Biomech: 1
    BE_Bioelec: 1
    BE_Biomed: 1
  desc: "Limits, derivatives, and integrals of functions of one variable."
```

**Fields:**
| Field | Required | Description |
|-------|----------|-------------|
| `id` | yes | Unique identifier (used for prereq/coreq references) |
| `code` | yes | Display code (e.g. "ME 270") |
| `title` | yes | Course title |
| `credits` | yes | Credit hours |
| `tags` | yes | Array of tag keys from `_data/tags.yml` |
| `prereqs` | yes | Array of course `id`s that are prerequisites |
| `coreqs` | yes | Array of course `id`s that are co-requisites |
| `semesters` | yes | Object mapping program keys to semester numbers (1-8) |
| `desc` | no | Course description |
| `isPlaceholder` | no | Set `true` for elective slots |
| `eligible` | no | Array of eligible course strings (for placeholders) |

**Program keys:** `ME`, `BE_Biomech`, `BE_Bioelec`, `BE_Biomed`

## Other Data Files

- `_data/tags.yml` — Filter tag definitions (key, label, colors)
- `_data/semesters.yml` — Semester metadata (number, year, season)
- `_data/nav.yml` — Navigation links

## Deployment

- Push to `main` → deploys to production (root of gh-pages)
- Push to `dev` → deploys to `/dev` subfolder on gh-pages

Both workflows use GitHub Actions with `peaceiris/actions-gh-pages@v4`.

## Project Structure

```
├── _config.yml          # Main Jekyll config
├── _config.dev.yml      # Dev override (baseurl: /dev)
├── _data/               # YAML data files (easy to edit)
├── _includes/
│   ├── head.html
│   ├── nav.html
│   ├── footer.html
│   └── degree-map/      # Degree map HTML partials
├── _layouts/
│   ├── default.html     # Base HTML skeleton
│   ├── page.html        # Generic content page
│   └── degree-map.html  # Injects YAML data as JSON for JS
├── _pages/
│   ├── index.md         # Landing page (/)
│   └── curriculum.html  # Degree map (/curriculum/)
├── assets/
│   ├── css/
│   │   ├── main.css         # Site-wide styles + Valpo brand
│   │   └── degree-map.css   # Degree map component styles
│   └── js/
│       ├── main.js          # Mobile nav toggle
│       └── degree-map.js    # Degree map rendering engine
├── ReferenceDocuments/  # Excluded from build
└── .github/workflows/  # CI/CD
```

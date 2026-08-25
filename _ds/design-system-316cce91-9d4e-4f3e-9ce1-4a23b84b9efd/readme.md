# Vibrant — Design System

> **Vibrant Wellness is the precision lab that enables provider-led personalized medicine.**
> "Testing that tells the whole story." One comprehensive panel. Complete answers.

This project is the rebranded Vibrant design system: brand foundations, tokens, reusable React components, and high-fidelity product recreations (the lab report + provider portal). Consumers link a single file — **`styles.css`** — to inherit every token and webfont.

---

## Company & product context

Vibrant is a clinical laboratory running comprehensive diagnostic panels (Gut Zoomer, Micronutrient, Food Sensitivity, Wheat/Heavy-metals zoomers, etc.) **under one roof, with one methodology, in one report** — positioned against "47 different vendors pieced together." Its signature deliverable is the **test report**: dense tables of biomarkers, each shown against a colored reference range with the patient's current value marked. Providers order panels and review flagged results through a web portal; patients receive shareable reports.

The current work is a **rebrand** (internally "Rebranded Vibrant Library") moving from the older teal/dark-blue "Vibrant Wellness" identity to a stark, engineered black-and-white system with a single electric-blue accent.

### Surfaces represented here
- **Lab Report** (`ui_kits/lab_report/`) — the Gut Zoomer report viewer; the hero artifact.
- **Provider Portal** (`ui_kits/portal/`) — results dashboard / order tracking web app.

---

## Sources (for whoever has access)

- **Figma:** "Rebranded Vibrant Library" .fig — a large component library (181 component families, ~92 icons, 2 variable collections / 173 variables). Pages: Color-Palettes, Typography, Buttons, Badge, Breadcrumb, Chip, Datepicker, Checkbox, File-Uploader, Inputs (Text/Area/Dropdown), Modal, Notification-Bars, Number-Input, Pagination, Progress-Indicator, Radio, Repeater, Step-Accordion, Tab-Groups, Tooltip, Toggle-Switch. Tokens were materialized via fig_materialize into `tokens/fig-tokens.css`.
- **Brand book** (uploaded screenshots, "VISUAL DESIGN / BRAND BOOK" pp. 3–28) — logo, clearspace, wordmark usage, typography (ABC Oracle + GT Pressura Mono), typesetting hierarchy, fallbacks. This is the authority for brand voice & visual foundations.
- **Sample report** (uploaded) — Gut Zoomer summary PDF page; the model for the lab-report kit and the ResultBar component.
- **Prototype:** Figma proto `Vibrant-Wellness---HS--Preview` (node 7215-772).

---

## CONTENT FUNDAMENTALS — how Vibrant writes

- **Voice:** confident, precise, clinical-but-human. Declarative. Often uses short, punchy sentence fragments for emphasis ("Complete answers." / "One comprehensive panel.").
- **Person:** speaks as "we"/"our" about the lab; addresses the provider/patient as "you" / "your." ("Working alongside your healthcare provider, this advanced diagnostic maps your unique microbiome.")
- **Casing:** Headlines in sentence case. Mono **eyebrows/labels in UPPERCASE** with wide tracking ("PRECISION TESTING. PERSONALIZED MEDICINE.", "WHAT WE MEASURE"). Buttons set in mono uppercase ("EXPLORE TEST KITS").
- **Contrast device:** define the product by what it is *not* ("Not 47 different vendors pieced together. Not point solutions that leave gaps in the story.").
- **Numbers:** specific and clinical (values, reference ranges, marker counts). No vague hype.
- **Emoji:** none. Not part of the brand.
- **Tone examples:** "Testing that tells the whole story." · "See the whole system." · "One Comprehensive panel. Complete answers."

---

## VISUAL FOUNDATIONS

- **Palette:** near-monochrome. **Ink black `#161616`** + **lab-coat white `#F3F3F3`** carry everything; **Rebranding Blue `#0142E2`** is the *single* brand accent (links, primary buttons, active states). A full neutral ramp (90→02) handles hierarchy. Clinical **red / amber / green** + a **teal value-marker** are reserved strictly for lab-report data viz — never decoration.
- **Logo:** a geometric molecular **brandmark** (a central body with three orbiting nodes) + the **"VIBRANT" wordmark** in light, very wide-tracked caps (~0.22em). Logo is only ever ink or white — never colored. Clearspace = brandmark width / 50px; digital min width 100px.
- **Type:** **ABC Oracle** (primary, neo-grotesque) for headlines + body; **GT Pressura Mono** (secondary) for small headers, labels, buttons, and data. Per the brand book's own fallback page, digital fallbacks are **Inter** (→ABC Oracle) and **Roboto Mono** (→GT Pressura Mono) — which is what this system loads (real trial fonts aren't redistributable).
  - Headlines: ABC Oracle Medium, **line-height ~85–90%**, tracking tightened (large display brought in ~-40 to -70 units → ~-0.03em). Body: ABC Oracle Book, line-height ~140%. **Copy is always left-aligned, never justified.** Optical kerning.
- **Spacing:** 4px base unit; tight, deliberate rhythm.
- **Corners:** **engineered, restrained** — 2–8px. App controls 4px; chips/pills/switches capsule; marketing CTAs can be capsule pills. Nothing is heavily rounded/soft.
- **Cards:** white surface, 1px hairline border (`--border-subtle`), `--radius-lg` (8px), faint cool shadow (`--shadow-sm`). No colored left-border accent cards.
- **Shadows:** soft, low-spread, cool/neutral (`rgba(138,138,138,.08–.12)`); used sparingly for elevation, not drama.
- **Backgrounds:** mostly flat lab-coat white or pure white; the ink-black section header bar and dark portal rail provide contrast. **No gradients.** Brand photography is high-key scientific imagery (glassware, microscopy, petri textures), often in circular crops — used full-bleed behind white logo when present.
- **Motion:** quiet and functional — short fades / 120–260ms transitions on `cubic-bezier(0.2,0,0,1)`. No bounce, no infinite loops.
- **States:** hover = subtle tint wash (5% of accent) on ghost/outlined, slightly deeper fill on filled; press = 10% tint / deeper. Focus = blue border. Disabled = neutral gray fill / 0.5 opacity.
- **Transparency/blur:** minimal; scrims for modals (`rgba(22,22,22,.45)`). Not a glassmorphism brand.
- **Imagery vibe:** clinical, precise, neutral-to-cool; circular masks for microscopy crops.

---

## ICONOGRAPHY

- The Figma library carries a **large in-house icon set (~92 "Created Icons" glyphs)** in a Material-adjacent style: 24px grid, mostly **solid/filled**, geometric, single-color (inherit `currentColor`, typically ink or icon-grey `#374957`). Names mirror Material (`add_24px`, `delete_24px`, `file_download`, `calendar_month`, `cloud_upload`, `arrow_forward`, etc.).
- **Approach:** icons are utilitarian and quiet — they support data and controls, never decorate. Single weight, no duotone, no color fills beyond state colors.
- **In this system:** small inline UI glyphs (checkmarks, chevrons, close ×) are drawn as minimal inline SVG inside components, sized to match. The brandmark is the only "illustrative" mark.
- **No emoji. No unicode-as-icon.** The mono `/` separator in breadcrumbs is the one typographic-as-glyph usage.
- **`Icon` component:** ships as a Material Symbols (Rounded, **filled**) wrapper — the documented closest match to the in-house set (same 24px grid, solid fill, single-color via `currentColor`). Any Material ligature name works (`science`, `cloud_upload`, `arrow_forward`, …). The host loads the Material Symbols stylesheet once (cards/kits do). Swap to the licensed in-house glyph SVGs when available — the raw Figma "Created Icons" set extracts only as non-semantic variant indices, so it was intentionally not bundled (2MB of unnamed glyphs).

---

## Index / manifest

**Root**
- `styles.css` — global entry (imports only). Link this.
- `tokens/` — `fonts.css`, `colors.css`, `typography.css`, `spacing.css`, `fig-tokens.css` (materialized Figma variables, all theme modes).
- `assets/brandmark.svg` — molecular brandmark (recreated; see caveats).
- `guidelines/` — foundation specimen cards (Type, Colors, Spacing).
- `readme.md`, `SKILL.md`.

**Components** (`window.DesignSystem_316cce.<Name>`)
- `core/` — Button, Card, Chip, Avatar
- `forms/` — Input, Textarea, Select, MultiSelect, PhoneInput, NumberInput, DatePicker, FileUploader, Checkbox, Radio, Switch
- `feedback/` — Badge, NotificationBar, Toast / ToastStack, Tooltip, ProgressIndicator, Modal
- `navigation/` — Tabs, Accordion, Menu, Breadcrumb, Pagination
- `data/` — **ResultBar** (signature lab range bar), DataTable
- `icons/` — Icon (Material Symbols Rounded, filled — closest match to the in-house set)
- `brand/` — Logo

**UI kits**
- `ui_kits/lab_report/` — Gut Zoomer report viewer (hero).
- `ui_kits/portal/` — provider results dashboard.

---

## CAVEATS
- **Primary font now self-hosted.** **ABC Oracle** is wired from brand-supplied files in `/fonts` (full weight range Thin→Black + italics, `tokens/fonts.css`) and is the primary `--font-sans`. **GT Pressura Mono** has not been supplied yet, so the mono family still falls back to **Roboto Mono** (Google CDN) per the brand book — swap in self-hosted GT Pressura Mono `@font-face` when available.
- **Brandmark recreated.** No logo asset existed in the Figma library (only the *old* Wellness logo). `assets/brandmark.svg` is a faithful geometric recreation from the brand book — replace with the official SVG when available.
- **Component coverage is curated, not exhaustive.** The Figma library lists 181 component families (many are micro-variants / internal building blocks). This system ships ~31 clean, brand-correct primitives covering the core surface area — forms, feedback, navigation, data, icons, brand — rather than mechanically materializing every variant set.

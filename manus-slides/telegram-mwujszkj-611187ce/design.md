## Design Concept
This deck serves as a technical architecture teardown and post-mortem, disguised as a cinematic case file. Anchored in tech-noir cinematic lighting (Blade Runner) and Swiss International Style for its data-dense diagrams, the design borrows the moody atmosphere of the former and the precision grids of the latter. The cliché for hacker/bot decks is falling green code or synthwave purple; we bypass this entirely for a restrained, high-contrast "wet asphalt" palette. The tendency is striking and cold: a graphite and deep night-blue background (#0A0F14), crisp cool-white text, illuminated exclusively by surgical cold cyan as the primary structural color and rare amber as the accent for evidence markers. The Type chain provides the `Technical` set (IBM Plex Sans), delivering a sharp, institutional, and highly readable voice that perfectly suits precise architectural schematics and high-contrast night interfaces.

## Visual Language
- **Imagery**: Cinematic night photography, high-contrast, moody. Subjects include wet asphalt, port cranes, archival folders, dim analog clocks, and macro shots of hardware/locks. No GTA/Rockstar branding, no cartoonish illustrations, no synthwave grids. All architectural and state diagrams must be drawn natively.
- **Containers**: Card-based technical HUD. 0px corner radius everywhere (sharp, institutional). Cards and panels use a 1px solid stroke in the primary cyan token. Framed photos have no edge treatment unless blending into the dark background, where a 1px graphite stroke may be used.
- **Icons**: Outline, highly technical, minimal, used only for system nodes or archival UI elements.
- **Dataviz**: Sharp, flat charts and native diagrams. System nodes in cyan, warnings/evidence nodes in amber. Lines are strictly orthogonal.
- **Motif**: An amber evidence marker — a small bracketed number `[ E-01 ]` (using the page number) — placed in the absolute top-right corner of every page.

## Layout Directives
- **Global**: 40px margins, strict left-alignment. Motif in top-right. Page numbers bottom-right in cyan.
- **Cover**: Cinematic backdrop, title, one subtitle line, one meta line. No other elements.
- **Table of Contents**: Not present in outline.
- **Section Dividers**: Not present in outline.
- **Closing**: Echo the cover.
- **Slide map**:

| id | pattern | image layout | cutouts | density |
|---|---|---|---|---|
| cover | Cinematic title cover | cover-full-bleed-scrim(wet asphalt at the port at night with distant cyan neon reflections) | none | low |
| player_flow | Linear flow diagram | inset@left(archival case file with physical timestamps) | none | medium |
| architecture | Detailed system architecture | strip-side@left(server rack cables illuminated in cold cyan light) | none | high |
| scenario_data | Data structure breakdown | side@right(detective evidence board in dim moody lighting) | none | medium |
| archive_states | Dual state machine diagrams | inset-narrow@right(macro of a heavy metallic combination lock) | none | high |
| case_08 | Timeline case study | split-major@left(analog clock reading 23:42 illuminated by an amber streetlight) | none | medium |
| data_and_safety | Two-column status comparison | strip-top(dark data center aisle in low light) | none | high |
| implementation_plan | Phased roadmap | side@right(rain-streaked window overlooking a dark industrial port) | none | medium |

## Design Tokens
| token | hex | usage |
|---|---|---|
| primary | #61AFBC | cold cyan for key diagram lines, active states, panel borders, and titles |
| body-text | #E6EDF3 | crisp cool white for high readability on dark backgrounds |
| secondary-text | #8B949E | muted grey-blue for captions, meta text, and inactive diagram nodes |
| background | #0A0F14 | deep graphite/night-blue for the canvas |
| surface | #161D24 | lighter graphite for HUD panels, code blocks, and data cards |
| divider | #30363D | subtle border lines for tables and structural grids |
| accent | #FFB020 | rare amber for evidence markers, warnings, and the page motif |

| role | family | size (px) | color | applies_to |
|---|---|---|---|---|
| display | IBM Plex Sans | 64–88 | body-text | cover titles |
| heading | IBM Plex Sans | 36–44 | primary | page titles |
| body | IBM Plex Sans | 22–28 | body-text | paragraphs and main bullets |
| data | IBM Plex Sans | 22–28 | primary | architecture labels, state names, code |
| caption | IBM Plex Sans | 14–18 | secondary-text | sources, notes, and the motif |

## Guardrails
- **Forbidden**: No pure black (#000000) or pure white (#FFFFFF) backgrounds; no rounded corners; no illustrations or generated imagery for the architecture diagrams; no purple/pink synthwave color palettes.
- **Size floors**: body ≥20px, caption ≥14px, table ≥14px, chart labels ≥16px.

## Color contrast
Checked by the slides add-on against the Colors table (WCAG contrast: text under 24 px — under 19 px at font-weight 700+ — needs 4.5:1; larger text and meaningful graphics need 3:1).
Text under 24 px uses only colors whose row says "any text" or the listed smaller-text variant (the -text rows added to the Colors table); card titles, subheads and labels under 24 px count as smaller text unless their font-weight is 700+. Keep the original accent hex for fills, lines, charts and large numerals. Text on a card, tag or icon tile filled with one of these colors uses the token its row gives "as a fill" — never another accent.

| token | hex | lowest contrast on the deck's backgrounds | text use |
|---|---|---|---|
| primary | #61AFBC | 6.77:1 on surface | any text; as a fill, text on it: background (7.66:1) |
| body-text | #E6EDF3 | 14.38:1 on surface | any text |
| secondary-text | #8B949E | 5.52:1 on surface | any text |
| accent | #FFB020 | 9.29:1 on surface | any text; as a fill, text on it: background (10.52:1) |

## Image frames
Resolved by the slides add-on from the Slide map's image layout column — canvas 1280×720 px, x, y = top-left corner. Generate one image per frame with exactly the listed aspect_ratio and place each image in its own frame (cover-fit); never reuse one image for several frames. Text boxes are where the layout expects the page text; when a layout lists no title box, the page title goes at the top of its first text box, in the same column — page titles and source notes never run across an image frame. Overlay rows put text on the image: ask the image prompt to keep that text box calm and the subject elsewhere, then look at the generated image before writing the page and move the text block to where the image is actually quiet. A scrim or panel under that text takes its color from the area it covers — on a dark area the palette color closest to that area's hue (or the darkest text color) at about 0.7 opacity with white text, on a light area the page background color at about 0.8 with the darkest text color — never a color the image does not have.
A text box given as w×h is the column beside the image. Fill it in four steps: (1) estimate the content's height at the Text role sizes; (2) keep each group together — a heading with its lines, a prompt with its questions, a note directly under the group it explains — with about one line of space between groups; (3) if lines fill less than about 60% of the box width or the stack is well short of the box, raise sizes toward the top of each role's range, or set each group in a card as wide as the box; if room is still left, add one item the outline already supports (an example, a definition, a check question) or a small explanatory cutout; (4) center the whole stack vertically in the box. Never spread groups to the top, middle and bottom of the box, and never pin a single note to its bottom.

| id | layout | image frame(s): x, y, w×h → aspect_ratio | text box(es): x, y, w×h or width (lines) |
|---|---|---|---|
| cover | cover-full-bleed-scrim (overlay) | 0, 0, 1280×720 → 16:9 | 60, 232, 470 wide — title (at most 2 lines, never one word on a line), one subtitle line, one meta line |
| player_flow | inset@left | 60, 65, 472×590 → 4:5 | 620, 120, 600×535 |
| architecture | strip-side@left | 0, 0, 180×720 → 1:4 | 240, 60, 900 wide (title) |
| scenario_data | side@right | 800, 0, 480×720 → 2:3 | 60, 120, 680×544 |
| archive_states | inset-narrow@right | 880, 150, 340×510 → 2:3 | 60, 60, 1160 wide (title); 60, 150, 780×510 |
| case_08 | split-major@left | 0, 0, 720×720 → 1:1 | 780, 210, 440×454 |
| data_and_safety | strip-top | 0, 0, 1280×320 → 4:1 | 60, 352, 700 wide (title); 840, 430, 380 wide (4 lines) |
| implementation_plan | side@right | 800, 0, 480×720 → 2:3 | 60, 120, 680×544 |

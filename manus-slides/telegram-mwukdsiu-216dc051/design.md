## Design Concept
This deck serves as a technical architecture handover and professional training module for the "12 Days Until Midnight" Telegram project. The posture is rigorous, structured, and practice-first, optimized for engineering and narrative design teams who need to understand complex system interactions. The visual foundation borrows from Edward Tufte's data-heavy clarity for information density and hierarchy, combined with the functional, unadorned utility of Dieter Rams' Braun design for clean component alignment. To avoid the neon-blue, hacker-green, and dark-mode cliches typical of bot and tech architecture presentations, the color story uses a "steady · harbor" palette: a mineral, blueprint-like off-white background with deep slate-blue primary typography, ensuring high-contrast projection safety. A singular terracotta accent highlights critical data flows and state changes. The type follows the Classic serif set, deploying authoritative serifs for structural headings and highly legible sans-serifs for dense technical body copy, projecting an academic yet engineered voice.

## Visual Language
- **Imagery**: Technical, schematic, and object-focused scenes (blueprints, physical archives, server racks, timepieces) treated with a muted, desaturated color grade to match the harbor palette. No abstract neon network nodes or decorative filler. Each image anchors a concrete system component (e.g., a physical filing cabinet for the archive state machine).
- **Containers**: Mixed approach utilizing whitespace-first text columns alongside structured cards for system nodes and code logic. Cards, panels, and framed images share a 4px corner radius. Cards and panels receive a 1px solid stroke in the primary ink color; framed images receive no stroke beyond the layout's boundary.
- **Icons**: Solid, precise, and geometric. Used strictly to demarcate architecture nodes (webhook, database, server) and player action types.
- **Dataviz**: Minimalist tables with a primary-color stroke on the header row and bottom boundary only; no zebra striping. Flow diagrams use native shapes with hard-angled connectors.
- **Motif**: A crisp 4px terracotta accent line spanning the top edge of every slide, acting as a structural anchor and progress indicator.

## Layout Directives
- **Global**: 40px margins. Strict left-alignment for all body text, lists, and code blocks. Motif placed flush at the top edge. Page numbers and source notes sit at the bottom right.
- **Cover**: Title, subtitle, and meta line strictly left-aligned in the bottom band. No body text or icons.
- **Table of contents**: Grid of section titles with brief descriptions; no plain bullet lists.
- **Section dividers**: Large section number paired with the title and a single lead-in sentence.
- **Closing**: Echoes the cover's band layout, leaving a clean space for Q&A or repository links.
- **Slide map**:

| id | pattern | image layout | cutouts | density |
|---|---|---|---|---|
| cover | title over bottom text band | cover-band-bottom(blueprint schematic of a clock) | none | low |
| player_flow | process steps across page | steps(smartphone, case file, clue puzzle, archive box) | none | medium |
| architecture | dense text beside vertical strip | strip-side@left(server rack and network cables) | none | high |
| scenario_data | image beside structured data specs | split-major@left(organized database tables) | none | high |
| archive_states | narrow image column balancing states | inset-narrow@right(metal filing cabinet drawers) | none | medium |
| case_08 | image beside specific case details | side@left(vintage pocket watch on a desk) | none | medium |
| data_and_safety | side-by-side technical comparison | pair(steel vault door, stamped test sheet) | none | high |
| implementation_plan | linear progression of phases | filmstrip(calendar, database mapping, archive folders, testing lab) | none | medium |

## Design Tokens
| token | hex | usage |
|---|---|---|
| primary | #0C4A7A | Display text, primary headings, key architecture nodes |
| body-text | #15232F | Body paragraphs, list items, table data |
| secondary-text | #4A5A6A | Captions, meta lines, secondary code comments |
| background | #F1F6F8 | Base slide canvas |
| surface | #E5EBED | Code blocks, architecture node cards |
| divider | #D0D9DF | Table borders, subtle structural lines |
| accent | #DA6D5D | The top edge motif, critical flow arrows, highlighted data points |
| accent-text | #B93C2A | accent for text under 24 px (added by the slides add-on: accent is 2.75:1 on surface) |

| role | family | size (px) | color | applies_to |
|---|---|---|---|---|
| display | Source Serif 4 | 54–64 | primary | Cover and section headlines |
| heading | Source Serif 4 | 36–42 | primary | Slide titles |
| body | Source Sans 3 | 22–28 | body-text | Paragraphs, lists, definitions |
| data | Source Sans 3 | 22–28 | body-text | Database field names, numbers |
| caption | Source Sans 3 | 14–18 | secondary-text | Page numbers, small metadata |
| code | JetBrains Mono | 18–22 | body-text | server.mjs excerpts, JSON payloads |

## Guardrails
- **Forbidden**: Neon colors or cyber-hacker aesthetic markers; strictly avoid "dark mode" content pages which fail in bright projection environments.
- **Forbidden**: Pure white (#FFFFFF) backgrounds; the mineral off-white canvas must be maintained to reduce eye strain during dense technical reading.
- **Forbidden**: Paragraphs exceeding 6 lines; all logic flows must be broken into numbered lists, code blocks, or native diagram shapes.
- **Size floors**: body ≥ 20px, code ≥ 18px, caption ≥ 14px. Never reduce sizes to force-fit content; split the slide or use a diagram instead.

## Color contrast
Checked by the slides add-on against the Colors table (WCAG contrast: text under 24 px — under 19 px at font-weight 700+ — needs 4.5:1; larger text and meaningful graphics need 3:1).
Text under 24 px uses only colors whose row says "any text" or the listed smaller-text variant (the -text rows added to the Colors table); card titles, subheads and labels under 24 px count as smaller text unless their font-weight is 700+. Keep the original accent hex for fills, lines, charts and large numerals. Text on a card, tag or icon tile filled with one of these colors uses the token its row gives "as a fill" — never another accent.

| token | hex | lowest contrast on the deck's backgrounds | text use |
|---|---|---|---|
| primary | #0C4A7A | 7.66:1 on surface | any text; as a fill, text on it: background (8.46:1) |
| body-text | #15232F | 13.27:1 on surface | any text |
| secondary-text | #4A5A6A | 5.88:1 on surface | any text |
| accent | #DA6D5D | 2.75:1 on surface | graphics and fills only; use #B93C2A (accent-text) for any text; as a fill, text on it: body-text (4.81:1) |

## Image frames
Resolved by the slides add-on from the Slide map's image layout column — canvas 1280×720 px, x, y = top-left corner. Generate one image per frame with exactly the listed aspect_ratio and place each image in its own frame (cover-fit); never reuse one image for several frames. Text boxes are where the layout expects the page text; when a layout lists no title box, the page title goes at the top of its first text box, in the same column — page titles and source notes never run across an image frame.
Rows marked (n items) list one line per item count: pick the line for the number of items the page actually has, generate each image with that line's aspect_ratio and place it at that line's coordinates. If the page's count is not listed, use another image layout from the catalog that lists that count — never drop the images or leave a gap.
A text box given as w×h is the column beside the image. Fill it in four steps: (1) estimate the content's height at the Text role sizes; (2) keep each group together — a heading with its lines, a prompt with its questions, a note directly under the group it explains — with about one line of space between groups; (3) if lines fill less than about 60% of the box width or the stack is well short of the box, raise sizes toward the top of each role's range, or set each group in a card as wide as the box; if room is still left, add one item the outline already supports (an example, a definition, a check question) or a small explanatory cutout; (4) center the whole stack vertically in the box. Never spread groups to the top, middle and bottom of the box, and never pin a single note to its bottom.

| id | layout | image frame(s): x, y, w×h → aspect_ratio | text box(es): x, y, w×h or width (lines) |
|---|---|---|---|
| cover | cover-band-bottom | 0, 272, 1280×448 → 21:9 | 60, 34, 1160 wide — title (at most 2 lines, never one word on a line), one subtitle line, one meta line |
| player_flow (3 items) | steps | 60, 212, 360×203 → 16:9; 460, 212, 360×203 → 16:9; 860, 212, 360×203 → 16:9 | 60, 60, 700 wide (title); 60, 492, 360 wide (3 lines); 460, 492, 360 wide (3 lines); 860, 492, 360 wide (3 lines) |
| player_flow (4 items) | steps | 60, 216, 260×195 → 4:3; 360, 216, 260×195 → 4:3; 660, 216, 260×195 → 4:3; 960, 216, 260×195 → 4:3 | 60, 60, 700 wide (title); 60, 488, 260 wide (3 lines); 360, 488, 260 wide (3 lines); 660, 488, 260 wide (3 lines); 960, 488, 260 wide (3 lines) |
| player_flow (5 items) | steps | 60, 207, 213×213 → 1:1; 297, 207, 213×213 → 1:1; 534, 207, 213×213 → 1:1; 770, 207, 213×213 → 1:1; 1007, 207, 213×213 → 1:1 | 60, 60, 700 wide (title); 60, 497, 213 wide (3 lines); 297, 497, 213 wide (3 lines); 534, 497, 213 wide (3 lines); 770, 497, 213 wide (3 lines); 1007, 497, 213 wide (3 lines) |
| player_flow (6 items) | steps | 60, 205, 173×217 → 4:5; 257, 205, 173×217 → 4:5; 455, 205, 173×217 → 4:5; 652, 205, 173×217 → 4:5; 849, 205, 173×217 → 4:5; 1047, 205, 173×217 → 4:5 | 60, 60, 700 wide (title); 60, 499, 173 wide (3 lines); 257, 499, 173 wide (3 lines); 455, 499, 173 wide (3 lines); 652, 499, 173 wide (3 lines); 849, 499, 173 wide (3 lines); 1047, 499, 173 wide (3 lines) |
| architecture | strip-side@left | 0, 0, 180×720 → 1:4 | 240, 60, 900 wide (title) |
| scenario_data | split-major@left | 0, 0, 720×720 → 1:1 | 780, 210, 440×454 |
| archive_states | inset-narrow@right | 880, 150, 340×510 → 2:3 | 60, 60, 1160 wide (title); 60, 150, 780×510 |
| case_08 | side@left | 0, 0, 480×720 → 2:3 | 540, 120, 680×544 |
| data_and_safety | pair | 150, 136, 400×500 → 4:5; 730, 136, 400×500 → 4:5 | 380, 56, 520 wide (title); 250, 656, 200 wide (title); 830, 656, 200 wide (title) |
| implementation_plan (4 items) | filmstrip | 60, 190, 260×325 → 4:5; 360, 190, 260×325 → 4:5; 660, 190, 260×325 → 4:5; 960, 190, 260×325 → 4:5 | 60, 60, 700 wide (title); 60, 545, 260 wide (2 lines); 360, 545, 260 wide (2 lines); 660, 545, 260 wide (2 lines); 960, 545, 260 wide (2 lines) |
| implementation_plan (5 items) | filmstrip | 60, 192, 213×319 → 2:3; 297, 192, 213×319 → 2:3; 534, 192, 213×319 → 2:3; 770, 192, 213×319 → 2:3; 1007, 192, 213×319 → 2:3 | 60, 60, 700 wide (title); 60, 542, 213 wide (2 lines); 297, 542, 213 wide (2 lines); 534, 542, 213 wide (2 lines); 770, 542, 213 wide (2 lines); 1007, 542, 213 wide (2 lines) |
| implementation_plan (6 items) | filmstrip | 60, 198, 173×308 → 9:16; 257, 198, 173×308 → 9:16; 455, 198, 173×308 → 9:16; 652, 198, 173×308 → 9:16; 849, 198, 173×308 → 9:16; 1047, 198, 173×308 → 9:16 | 60, 60, 700 wide (title); 60, 536, 173 wide (2 lines); 257, 536, 173 wide (2 lines); 455, 536, 173 wide (2 lines); 652, 536, 173 wide (2 lines); 849, 536, 173 wide (2 lines); 1047, 536, 173 wide (2 lines) |
| implementation_plan (7 items) | filmstrip | 60, 223, 145×258 → 9:16; 229, 223, 145×258 → 9:16; 398, 223, 145×258 → 9:16; 567, 223, 145×258 → 9:16; 737, 223, 145×258 → 9:16; 906, 223, 145×258 → 9:16; 1075, 223, 145×258 → 9:16 | 60, 60, 700 wide (title); 60, 511, 145 wide (2 lines); 229, 511, 145 wide (2 lines); 398, 511, 145 wide (2 lines); 567, 511, 145 wide (2 lines); 737, 511, 145 wide (2 lines); 906, 511, 145 wide (2 lines); 1075, 511, 145 wide (2 lines) |

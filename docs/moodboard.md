# TabForest — Moodboard & Visual Design System

> *“Browsers remember where you went. TabForest remembers why.”*

This document defines the visual identity, typography, color palette, and data-encoded SVG metaphors for the **TabForest Living Grove**.

---

## 1. Design Philosophy: The Living Grove

Unlike typical AI dashboards with generic purple gradients or arbitrary cards, TabForest is modeled as an organic forest where **every visual property encodes actual data**.

- **No generic AI tropes**: No ungrounded neon glows, sparkle icons without semantic meaning, or fake progress bars.
- **Organic & Grounded**: Deep forest greens, warm bark, mossy stone, and soft bioluminescent fireflies.
- **Dual Encoding**: Meaning is never conveyed by color alone; every element has a distinct geometric shape, icon, and accessible `<title>` / tooltip.

---

## 2. Typography

We pair an editorial serif with a crisp geometric sans-serif to create an artisanal yet technical atmosphere:

| Role | Font Family | Weights | Usage |
|---|---|---|---|
| **Headings & Narrative** | **Lora** (Serif) | 500, 600, Italic | Project goals, reconstructed intents, insight summaries, modal titles |
| **Interface & Data** | **Inter** (Sans) | 400, 500, 600, 700 | Navigation labels, metadata, dwell times, domain tags, buttons, code |

```css
font-family-serif: 'Lora', Georgia, serif;
font-family-sans: 'Inter', system-ui, -apple-system, sans-serif;
```

---

## 3. Curated Color Palette

Tailored HSL values optimized for high contrast, dark mode immersion, and accessibility:

### 3.1 Forest Backgrounds & Canopy Greens
- **Forest 950 (Canvas Background)**: `#07120a` — Deep night forest floor
- **Forest 900 (Surface / Panel)**: `#0f2015` — Soft card container background
- **Forest 800 (Card / Sub-panel)**: `#1b3322` — Elevated card border & background
- **Forest 600 (Primary Action)**: `#3a6c47` — "Grow grove", active primary button
- **Forest 400 (Active Leaves & Branches)**: `#6ea57c` — Vibrant active research tabs
- **Forest 50 (Primary Text)**: `#f2f8f4` — High contrast readable content

### 3.2 Dormant & Organic Accent Colors
- **Amber Canopy (`#d9822b`, `#f5c26b`)**: Dormant projects (no activity for 3+ days)
- **Moss Green (`#729861`, `#a3c293`)**: Inferred decisions & organic terrain accents
- **Stone Gray (`#78909c`, `#cfd8dc`)**: Carved stated decisions & stable bedrock
- **Firefly Gold (`#ffd54f`, `#fff7a0`)**: Long-term memory connections & search highlights
- **Mist Fog (`rgba(210, 225, 218, 0.75)`)**: Low confidence ($\text{density} \propto 1 - \text{confidence}$)

---

## 4. Parameterized Forest Elements & Data Encodings

| Element | Data Encoded | Shape / Visual Trait | Interaction |
|---|---|---|---|
| **Tree** | Project / Major Intent | Parameterized SVG trunk + 3 canopy blobs. Trunk thickness = total attention minutes. Canopy = Green (active) vs Amber (dormant 3+ days). | Click $\rightarrow$ Opens Tree Detail drawer |
| **Branch** | Sub-goal / Research Path | Radiating branch lines from trunk. Length $\propto$ activity recency. | Hover $\rightarrow$ Highlights connected leaves & roots |
| **Leaf** | Individual Tab | Teardrop / leaf SVG node. Size = dwell time. Glowing stroke = currently open tab. | Click $\rightarrow$ Opens / focuses tab via extension bridge |
| **Sprout** | Emerging Cluster | Small sprouting seedling node at forest edge (&lt; 30 min old, &lt; 3 tabs). | Hover tooltip: "Emerging intent" |
| **Mushroom** | Unresolved Question | Organic capped mushroom at tree base. Cap size = search recurrence count. | Click $\rightarrow$ View question & "Mark resolved" |
| **Stone** | Decision | **Carved Stone**: Solid rectangular rock with chiseled icon (`stated` / `sourced`). **Mossy Stone**: Dashed border rock covered in moss (`inferred`). | Click $\rightarrow$ "Confirm" turns mossy stone into carved stone |
| **Flower** | Resolved Question | Blooming 5-petal flower (mushroom transforms into flower upon resolution). | Click $\rightarrow$ View answer & timestamp |
| **Vine** | Redundant / Duplicate Source | Braided vine wrapped around redundant leaves. Thicker for exact URL duplicates. | Click $\rightarrow$ Opens Prune suggestion dialog |
| **Fallen Leaf** | Stale Tab | Leaf resting horizontally on the forest floor beneath its branch. | Click $\rightarrow$ "Sweep to references" or close |
| **Fog** | Low AI Confidence | Layered misty cloud. Alpha density $\propto 1 - \text{confidence}$ (claims &lt; 0.60). | "Clear the fog" $\rightarrow$ Name goal / add note |
| **Roots** | Evidence Trail | Subterranean root lines radiating downwards from selected decision/question to evidence leaves. | Lights up on claim selection |
| **Firefly** | Past Research Memory | Soft pulsing luminescent particle hovering between a tree and past groves. | Click $\rightarrow$ "You researched this on March 12" |

---

## 5. Accessibility & Motion Guidelines

1. **Dual Encoding**: Every element couples visual shape/color with an icon and clear textual badge.
2. **Keyboard Focus**: Sequential tab order follows trees from left to right, then sub-elements.
3. **Outline View**: A one-click toggle converts the SVG Living Grove into an accessible nested hierarchical tree list for screen readers.
4. **Reduced Motion**: Respects `prefers-reduced-motion: reduce`. Replaces physical grow animation with a crisp 300 ms cross-fade.

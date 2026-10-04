// Colors for the D3 grove. Values mirror tailwind.config.js and docs/moodboard.md;
// D3 sets them as SVG attributes, so they cannot come from Tailwind classes.
export const PALETTE = {
  ground: '#1b3322', // forest-800
  groundLine: '#2f5539', // forest-700
  trunk: '#715c4a', // bark-600
  branch: '#8b745e', // bark-500
  canopyGreen: '#2f5539', // forest-700
  canopyAmber: '#a85b13', // amberCanopy-dark
  leafGreen: '#6ea57c', // forest-400
  leafAmber: '#f5c26b', // amberCanopy-light
  leafOpenEdge: '#f2f8f4', // forest-50
  meadowLeaf: '#a3c293', // moss-light
  sproutLeaf: '#9bc4a5', // forest-300
  stem: '#4c875b', // forest-500
  fog: 'rgb(210, 225, 218)', // fog
  fogLeaf: '#78909c', // stoneGray
  text: '#f2f8f4', // forest-50
  textMuted: '#9bc4a5', // forest-300
  halo: '#07120a', // forest-950, behind labels that sit over the canopy
} as const;

export const FONT = {
  serif: "'Lora', Georgia, serif",
  sans: "'Inter', system-ui, -apple-system, sans-serif",
} as const;

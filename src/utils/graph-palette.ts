/**
 * Stable hue assignments for vault folders.
 *
 * The graph groups notes by their top-level folder. Keep the hues spread around
 * the wheel so adjacent folders stay visually distinct without needing a
 * fifteen-color legend full of near-duplicates.
 */
const FOLDER_HUES: Record<string, number> = {
  'offensive-security': 10,
  tools: 40,
  linux: 65,
  grc: 90,
  'system-security': 115,
  'defensive-security': 140,
  basics: 185,
  networking: 205,
  'web-security': 230,
  root: 250,
  projects: 270,
  cryptography: 290,
  writeups: 310,
  posts: 330,
  'vulns-attacks': 350
}

function fallbackHue(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0
  }
  return Math.abs(hash) % 360
}

export function getFolderHue(folder: string): number {
  const key = folder.trim().toLowerCase()
  return FOLDER_HUES[key] ?? fallbackHue(key || 'root')
}

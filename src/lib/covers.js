function hashString(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

const COVER_PALETTES = [
  ['#8B6F5C', '#5C3D2E', '#3A2218'],
  ['#4A5548', '#2D3A2B', '#1A2318'],
  ['#C4956A', '#A67B5B', '#8B6347'],
  ['#6F5A4D', '#503A31', '#33211B'],
  ['#69725E', '#46503F', '#2B3428'],
  ['#A27A5D', '#7D5A45', '#53382C'],
  ['#7F6758', '#5B463B', '#3B2922'],
  ['#5F6A58', '#3E4738', '#242B22'],
];

export function generateCoverGradient(bookId) {
  const h = hashString(bookId || 'default');
  const palette = COVER_PALETTES[h % COVER_PALETTES.length];
  const angle = 145 + ((h >>> 4) % 5 - 2) * 6;
  const textureAngle = 24 + ((h >>> 8) % 4) * 9;
  const highlightX = 68 + ((h >>> 12) % 10);
  const highlightY = 14 + ((h >>> 16) % 12);

  return [
    `repeating-linear-gradient(${textureAngle}deg, rgba(255,255,255,0.03) 0 8px, rgba(255,255,255,0.055) 8px 16px)`,
    `radial-gradient(circle at ${highlightX}% ${highlightY}%, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.06) 16%, transparent 42%)`,
    `linear-gradient(${angle}deg, ${palette[0]} 0%, ${palette[1]} 58%, ${palette[2]} 100%)`,
  ].join(', ');
}

function hashString(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

// Warm hue palette: terracotta, amber, rust, sienna, olive, burgundy
const WARM_HUES = [18, 25, 32, 38, 45, 12, 350, 355, 8, 52];

export function generateCoverGradient(bookId) {
  const h = hashString(bookId || 'default');
  const hue1 = WARM_HUES[h % WARM_HUES.length];
  const hue2 = WARM_HUES[(h >> 8) % WARM_HUES.length];
  const angle = (h >> 4) % 360;
  const pattern = h % 4;
  const sat1 = 28 + ((h >> 12) % 18);
  const light1 = 38 + ((h >> 16) % 18);
  const sat2 = 25 + ((h >> 20) % 20);
  const light2 = 42 + ((h >> 24) % 16);

  const c1 = `hsl(${hue1},${sat1}%,${light1}%)`;
  const c2 = `hsl(${hue2},${sat2}%,${light2}%)`;
  const texture = `repeating-linear-gradient(${(angle + 30) % 360}deg, transparent, transparent 8px, rgba(255,255,255,0.04) 8px, rgba(255,255,255,0.04) 16px)`;

  switch (pattern) {
    case 0:
      return `${texture}, linear-gradient(${angle}deg, ${c1}, ${c2})`;
    case 1:
      return `${texture}, linear-gradient(${angle}deg, ${c1} 0%, ${c2} 60%, ${c1} 100%)`;
    case 2:
      return `${texture}, radial-gradient(ellipse at 30% 20%, ${c1}, ${c2})`;
    case 3:
      return `${texture}, radial-gradient(circle at 70% 80%, rgba(255,255,255,0.08) 0%, transparent 50%), linear-gradient(${angle}deg, ${c1}, ${c2})`;
    default:
      return `${texture}, linear-gradient(${angle}deg, ${c1}, ${c2})`;
  }
}

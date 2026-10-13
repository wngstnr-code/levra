/** A smooth line through points (Catmull-Rom as cubic Béziers), scaled into a width by height box. */
export function smoothPath(values: number[], width: number, height: number, pad = 6, domain?: [number, number]): { line: string; area: string; y: (v: number) => number } {
  const min = domain ? domain[0] : Math.min(...values);
  const max = domain ? domain[1] : Math.max(...values);
  const span = max - min || 1;
  const y = (v: number) => height - pad - ((v - min) / span) * (height - pad * 2);
  const pts = values.map((v, i) => [values.length === 1 ? width / 2 : (i / (values.length - 1)) * width, y(v)] as const);
  if (pts.length === 0) return { line: "", area: "", y };
  let line = `M ${pts[0]![0].toFixed(1)} ${pts[0]![1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    line += ` C ${c1[0]!.toFixed(1)} ${c1[1]!.toFixed(1)} ${c2[0]!.toFixed(1)} ${c2[1]!.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return { line, area: `${line} L ${width} ${height} L 0 ${height} Z`, y };
}

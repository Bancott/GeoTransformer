import type { FeatureCollection, Feature, Position } from 'geojson';

/**
 * GeoJSON -> CSV：
 * - 扁平化表格（每个要素一行，含代表坐标 lng/lat + 扁平化属性），用于「地图 → 表格分析」；
 * - 属性表（不含几何，仅属性），用于「Shapefile / GeoJSON 属性 -> Excel / CSV」。
 */

function esc(v: unknown): string {
  const s = String(v ?? '');
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function csvRow(cells: unknown[]): string {
  return cells.map(esc).join(',');
}

/** 取几何的代表坐标（取首个坐标）。无几何时返回 null。 */
function representativeCoord(geom: unknown): Position | null {
  if (!geom || typeof geom !== 'object') return null;
  const g = geom as { type?: string; coordinates?: unknown; geometries?: unknown[] };
  const first = (arr: unknown): Position | null => {
    if (!Array.isArray(arr) || arr.length === 0) return null;
    if (typeof arr[0] === 'number' && typeof arr[1] === 'number') return [arr[0], arr[1]];
    return first(arr[0]);
  };
  if (Array.isArray(g.coordinates)) return first(g.coordinates);
  if (g.type === 'GeometryCollection' && Array.isArray(g.geometries)) {
    for (const sub of g.geometries) {
      const p = representativeCoord(sub);
      if (p) return p;
    }
  }
  return null;
}

function flattenProps(props: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flattenProps(v as Record<string, unknown>, key));
    } else if (Array.isArray(v)) {
      out[key] = v.map((x) => (x && typeof x === 'object' ? JSON.stringify(x) : String(x)).slice(0, 200)).join(';');
    } else {
      out[key] = v;
    }
  }
  return out;
}

/** GeoJSON -> 扁平化 CSV 字符串 */
export function geoJSONToFlatCSV(fc: FeatureCollection): string {
  const rows: unknown[][] = [];
  const headers: string[] = ['lng', 'lat'];
  const keySet = new Set<string>();

  fc.features.forEach((f) => {
    const props = flattenProps((f.properties ?? {}) as Record<string, unknown>);
    Object.keys(props).forEach((k) => keySet.add(k));
  });

  headers.push(...Array.from(keySet));
  rows.push(headers);

  for (const f of fc.features as Feature[]) {
    const p = representativeCoord(f.geometry);
    const props = flattenProps((f.properties ?? {}) as Record<string, unknown>);
    const row: unknown[] = [p ? Number(p[0].toFixed(7)) : '', p ? Number(p[1].toFixed(7)) : ''];
    headers.forEach((h, i) => {
      if (i < 2) return;
      const v = props[h];
      row[i] = typeof v === 'object' ? JSON.stringify(v) : v ?? '';
    });
    rows.push(row);
  }

  return rows.map(csvRow).join('\n') + '\n';
}

/** GeoJSON -> 属性表 CSV（仅属性列，无几何） */
export function geoJSONToAttrCSV(fc: FeatureCollection): string {
  const features = fc.features as Feature[];
  const keySet = new Set<string>();
  features.slice(0, 2000).forEach((f) => {
    const p = (f.properties ?? {}) as Record<string, unknown>;
    Object.keys(p).forEach((k) => keySet.add(k));
  });
  const headers = Array.from(keySet);
  if (headers.length === 0) return '（无属性）\n';
  const rows: unknown[][] = [headers];
  for (const f of features) {
    const p = (f.properties ?? {}) as Record<string, unknown>;
    rows.push(headers.map((h) => (p[h] && typeof p[h] === 'object' ? JSON.stringify(p[h]) : p[h] ?? '')));
  }
  return rows.map(csvRow).join('\n') + '\n';
}

import type { FeatureCollection, Feature, Geometry } from 'geojson';
import { wkbToGeometry } from './wkb';
import { wktToGeometry } from './wkt';

/**
 * PostGIS dump（`pg_dump` 导出的 SQL / COPY 文本）-> GeoJSON。
 * 识别 COPY 数据块（`COPY ... FROM stdin;` 至 `\.` 结束），
 * 几何列支持 WKB（hex）或 WKT / EWKT 文本。
 */

const WKB_RE = /^[0-9a-fA-F]{18,}$/; // hex WKB（含 SRID 前缀也满足）
const WKT_RE = /^(POINT|LINESTRING|POLYGON|MULTIPOINT|MULTILINESTRING|MULTIPOLYGON|GEOMETRYCOLLECTION)/i;

function parseGeometry(value: string): Geometry | null {
  const v = value.trim();
  if (!v) return null;
  if (WKB_RE.test(v)) {
    try {
      // EWKB：去掉可能的 SRID 前缀（前 4 字节为 0x20000000 类型标志组合）
      return wkbToGeometry(v);
    } catch {
      return null;
    }
  }
  if (WKT_RE.test(v)) {
    try {
      // EWKT 形如 SRID=4326;POINT(...) —— 去掉前缀
      return wktToGeometry(v.replace(/^SRID=\d+;/, ''));
    } catch {
      return null;
    }
  }
  return null;
}

function looksLikeWktOrWkb(v: string): boolean {
  return WKB_RE.test(v.trim()) || WKT_RE.test(v.trim());
}

/** 从 PostGIS dump 文本解析出 GeoJSON */
export function postgisToGeoJSON(text: string): FeatureCollection {
  const lines = text.split(/\r?\n/);
  const features: Feature[] = [];

  let inCopy = false;
  let geometryCols: number[] = [];

  const flushRow = (row: string[]): void => {
    if (geometryCols.length === 0) {
      // 尝试判断哪一列是几何
      geometryCols = row.map((c, i) => (looksLikeWktOrWkb(c) ? i : -1)).filter((i) => i >= 0);
    }
    if (geometryCols.length === 0) return;
    let geometry: Geometry | null = null;
    for (const ci of geometryCols) {
      geometry = parseGeometry(row[ci]);
      if (geometry) break;
    }
    if (!geometry) return;
    const props: Record<string, unknown> = {};
    row.forEach((v, i) => {
      if (geometryCols.includes(i)) return;
      if (v !== '' && v !== '\\N') props['col' + (i + 1)] = v;
    });
    features.push({ type: 'Feature', properties: props, geometry });
  };

  for (const line of lines) {
    if (inCopy) {
      if (line === '\\.') {
        inCopy = false;
        continue;
      }
      if (line.trim() === '') continue;
      // PostGIS COPY 以制表符分隔；`\N` 表示 NULL
      const row = line.split('\t');
      if (row.length >= 1) flushRow(row);
      continue;
    }
    if (/^COPY\s+\S+\s*\(/i.test(line) && /from\s+stdin/i.test(line)) {
      inCopy = true;
      geometryCols = [];
    }
  }

  if (features.length === 0) throw new Error('PostGIS dump 中没有解析到几何数据');
  return { type: 'FeatureCollection', features };
}

import type { FeatureCollection, Feature, Point, LineString, Position } from 'geojson';
import type { CoordShift } from '@/core/types';
import { fmtNum, serializeXmlDoc, hasXmlDecl } from '@/format/xmlText';

/**
 * GPX（GPS 交换格式）↔ GeoJSON。
 * - 航点 <wpt>            -> Point
 * - 轨迹 <trk>/<trkseg>   -> LineString（多段时每段一条）
 * - 路径 <rte>/<rtept>    -> LineString
 * 坐标顺序为 lon,lat（与 GeoJSON 一致）。读用 DOMParser，写出用字符串拼接。
 */

/* ------------------------------ 读取 ------------------------------ */

function parseDoc(text: string): Document {
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('GPX 解析失败');
  return doc;
}

function num(el: Element | null | undefined, attr: string): number | null {
  const v = el?.getAttribute(attr);
  if (v == null) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function propsFrom(el: Element, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const p: Record<string, unknown> = { ...extra };
  const name = el.querySelector('name')?.textContent ?? '';
  const desc = el.querySelector('desc')?.textContent ?? '';
  const sym = el.querySelector('sym')?.textContent ?? '';
  if (name) p.name = name;
  if (desc) p.description = desc;
  if (sym) p.symbol = sym;
  return p;
}

/** GPX -> GeoJSON */
export function gpxToGeoJSON(text: string): FeatureCollection {
  const doc = parseDoc(text);
  const features: Feature[] = [];

  // 航点
  doc.querySelectorAll('wpt').forEach((wpt) => {
    const lon = num(wpt, 'lon');
    const lat = num(wpt, 'lat');
    if (lon == null || lat == null) return;
    const f: Feature<Point> = {
      type: 'Feature',
      properties: propsFrom(wpt, { __gpxType: 'waypoint' }),
      geometry: { type: 'Point', coordinates: [lon, lat] },
    };
    features.push(f);
  });

  // 轨迹
  doc.querySelectorAll('trk').forEach((trk) => {
    trk.querySelectorAll('trkseg').forEach((seg) => {
      const coords: Position[] = [];
      seg.querySelectorAll('trkpt').forEach((tp) => {
        const lon = num(tp, 'lon');
        const lat = num(tp, 'lat');
        if (lon == null || lat == null) return;
        coords.push([lon, lat]);
      });
      if (coords.length >= 2) {
        const f: Feature<LineString> = {
          type: 'Feature',
          properties: propsFrom(trk, { __gpxType: 'track' }),
          geometry: { type: 'LineString', coordinates: coords },
        };
        features.push(f);
      }
    });
  });

  // 路径
  doc.querySelectorAll('rte').forEach((rte) => {
    const coords: Position[] = [];
    rte.querySelectorAll('rtept').forEach((tp) => {
      const lon = num(tp, 'lon');
      const lat = num(tp, 'lat');
      if (lon == null || lat == null) return;
      coords.push([lon, lat]);
    });
    if (coords.length >= 2) {
      const f: Feature<LineString> = {
        type: 'Feature',
        properties: propsFrom(rte, { __gpxType: 'route' }),
        geometry: { type: 'LineString', coordinates: coords },
      };
      features.push(f);
    }
  });

  if (features.length === 0) throw new Error('GPX 中没有可解析的航点 / 轨迹 / 路径');
  return { type: 'FeatureCollection', features };
}

/* ------------------------------ 写出 ------------------------------ */

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function trkptXml(p: Position): string {
  return `<trkpt lat="${p[1].toFixed(7)}" lon="${p[0].toFixed(7)}"></trkpt>`;
}

function nameXml(props: Record<string, unknown> | null): string {
  const name = props?.name ?? '';
  return name ? `<name>${esc(name)}</name>` : '';
}

/** GeoJSON -> GPX 字符串（航点 -> wpt，线 -> trk，面 -> rte 仅外形） */
export function geoJSONToGPX(fc: FeatureCollection, docName?: string): string {
  const metas: string[] = [];
  const waypoints: string[] = [];
  const tracks: string[] = [];

  for (const f of fc.features as Feature[]) {
    const props = (f.properties ?? {}) as Record<string, unknown>;
    const geom = f.geometry;
    if (!geom) continue;
    switch (geom.type) {
      case 'Point': {
        const p = (geom as { coordinates: Position }).coordinates;
        const name = props.name ? `<name>${esc(props.name)}</name>` : '';
        waypoints.push(`  <wpt lat="${p[1].toFixed(7)}" lon="${p[0].toFixed(7)}">${name}</wpt>`);
        break;
      }
      case 'LineString': {
        const pts = (geom as { coordinates: Position[] }).coordinates;
        if (pts.length < 2) break;
        tracks.push(
          `  <trk>${nameXml(props)}<trkseg>${pts.map(trkptXml).join('')}</trkseg></trk>`
        );
        break;
      }
      case 'MultiLineString': {
        const lines = (geom as { coordinates: Position[][] }).coordinates;
        lines.forEach((pts) => {
          if (pts.length < 2) return;
          tracks.push(
            `  <trk>${nameXml(props)}<trkseg>${pts.map(trkptXml).join('')}</trkseg></trk>`
          );
        });
        break;
      }
      case 'Polygon': {
        const ring = (geom as { coordinates: Position[][] }).coordinates[0];
        if (ring && ring.length >= 4) {
          tracks.push(
            `  <trk>${nameXml(props)}<trkseg>${ring.map(trkptXml).join('')}</trkseg></trk>`
          );
        }
        break;
      }
      default:
        break; // MultiPoint / MultiPolygon / GeometryCollection 暂不支持
    }
  }

  const title = esc(docName ?? 'GeoTransformer-export');
  metas.push(`<name>${title}</name>`);
  const body = `${waypoints.join('\n')}${waypoints.length && tracks.length ? '\n' : ''}${tracks.join('\n')}`;
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<gpx version="1.1" creator="GeoTransformer" xmlns="http://www.topografix.com/GPX/1/1">\n` +
    `<metadata>${metas.join('')}</metadata>\n${body}\n</gpx>`
  );
}

/* --------------------------- 就地改写 GPX 坐标 --------------------------- */

/**
 * 在原始 GPX 文本上就地改写 lat / lon 属性，不经过 GeoJSON。
 *
 * 为什么需要它：GPX -> GeoJSON -> GPX 的往返会丢掉 `<ele>` 高程、`<time>` 时间与
 * `<extensions>` 心率等扩展，轨迹只剩裸坐标。就地改写只替换经纬度，其余原样保留。
 */

const LATLON_ELEMENTS = new Set(['wpt', 'trkpt', 'rtept']);

function attrNum(el: Element, name: string): number | null {
  const raw = el.getAttribute(name);
  if (raw == null) return null;
  const v = Number(raw);
  return Number.isFinite(v) ? v : null;
}

/** 递归改写航点 / 轨迹点 / 路径点的 lat、lon（dropAlt 时同时移除 <ele> 高程） */
function shiftLatLonAttrs(elem: Element, shift: CoordShift, dropAlt: boolean): number {
  let n = 0;
  for (const child of Array.from(elem.children)) {
    if (LATLON_ELEMENTS.has(child.localName)) {
      const lon = attrNum(child, 'lon');
      const lat = attrNum(child, 'lat');
      if (lon != null && lat != null) {
        const [x, y] = shift(lon, lat);
        if (Number.isFinite(x) && Number.isFinite(y)) {
          child.setAttribute('lon', fmtNum(x));
          child.setAttribute('lat', fmtNum(y));
          if (dropAlt) {
            for (const ele of Array.from(child.children)) {
              if (ele.localName === 'ele') ele.remove();
            }
          }
          n++;
        }
      }
    }
    n += shiftLatLonAttrs(child, shift, dropAlt);
  }
  return n;
}

/** <bounds> 的四个角同样偏移，保持包围盒与轨迹一致 */
function shiftBounds(doc: Document, shift: CoordShift): void {
  const bounds = Array.from(doc.getElementsByTagName('*')).filter((e) => e.localName === 'bounds');
  for (const b of bounds) {
    const minLat = attrNum(b, 'minlat');
    const minLon = attrNum(b, 'minlon');
    const maxLat = attrNum(b, 'maxlat');
    const maxLon = attrNum(b, 'maxlon');
    if (minLat == null || minLon == null || maxLat == null || maxLon == null) continue;
    const [x1, y1] = shift(minLon, minLat);
    const [x2, y2] = shift(maxLon, maxLat);
    b.setAttribute('minlon', fmtNum(Math.min(x1, x2)));
    b.setAttribute('maxlon', fmtNum(Math.max(x1, x2)));
    b.setAttribute('minlat', fmtNum(Math.min(y1, y2)));
    b.setAttribute('maxlat', fmtNum(Math.max(y1, y2)));
  }
}

/** 兜底：XML 无法解析时，逐个标签改写 lon / lat（minlat 等因词边界不会被误改） */
function shiftByRegex(text: string, shift: CoordShift): string {
  return text.replace(
    /<(?:[\w.-]+:)?(wpt|trkpt|rtept)\b[^>]*>/gi,
    (tag: string) => {
      const lon = matchAttr(tag, 'lon');
      const lat = matchAttr(tag, 'lat');
      if (lon == null || lat == null) return tag;
      const [x, y] = shift(lon, lat);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return tag;
      return replaceAttr(replaceAttr(tag, 'lon', fmtNum(x)), 'lat', fmtNum(y));
    }
  );
}

const NUM_SRC = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?';

function matchAttr(tag: string, name: string): number | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*"(${NUM_SRC})"`, 'i').exec(tag);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) ? v : null;
}

function replaceAttr(tag: string, name: string, value: string): string {
  return tag.replace(new RegExp(`(\\b${name}\\s*=\\s*")([^"]*)(")`, 'i'), '$1' + value + '$3');
}

export interface GpxConvertOptions {
  /** 丢弃高程（移除 <ele>），输出二维便于 GIS 软件按 2D 处理 */
  dropAltitude?: boolean;
}

/**
 * GPX 文本 -> 偏移后的 GPX 文本，保留高程、时间与扩展节点。
 * 找不到任何坐标点时抛错，交由调用方处理。
 */
export function convertGpxText(
  text: string,
  shift: CoordShift,
  options: GpxConvertOptions = {}
): string {
  const dropAlt = options.dropAltitude === true;
  const doc = parseDocLenient(text);
  if (doc && doc.documentElement) {
    const n = shiftLatLonAttrs(doc.documentElement, shift, dropAlt);
    if (n > 0) {
      shiftBounds(doc, shift);
      return serializeXmlDoc(doc, hasXmlDecl(text));
    }
  }
  const out = shiftByRegex(text, shift);
  if (out === text) throw new Error('未在 GPX 中找到 lat / lon 坐标点');
  return out;
}

/** 与 parseDoc 相同，但解析失败时返回 null 而不是抛错（用于就地改写兜底） */
function parseDocLenient(text: string): Document | null {
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  if (doc.querySelector('parsererror') || !doc.documentElement) return null;
  return doc;
}

import { kml } from '@tmcw/togeojson';
import type { FeatureCollection, Feature, Geometry, Position } from 'geojson';
import type { CoordShift } from '@/core/types';
import { NUM_SRC, fmtNum, collectByLocalName, serializeXmlDoc, hasXmlDecl } from '@/format/xmlText';

/* ------------------------------ 读取 KML -> GeoJSON ------------------------------ */

export function kmlToGeoJSON(text: string): FeatureCollection {
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  const errNode = doc.querySelector('parsererror');
  if (errNode) throw new Error('KML 解析失败：' + errNode.textContent);
  const fc = kml(doc);
  return fc as FeatureCollection;
}

/* ------------------------------ 写出 GeoJSON -> KML ------------------------------ */

function escapeXml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * KML 坐标串：高程缺省时**不补 0**。
 * 凭空出现的 Z 会让 QGIS / GDAL 之类的软件把数据判定为三维（EPSG:4979），
 * 进而影响后续的投影换算；没有高程就不写第三个数。
 */
function coordStr(pos: Position): string {
  const lng = Number(pos[0]).toFixed(7);
  const lat = Number(pos[1]).toFixed(7);
  const alt = pos.length > 2 ? Number(pos[2]) : NaN;
  return Number.isFinite(alt) ? `${lng},${lat},${alt.toFixed(3)}` : `${lng},${lat}`;
}

function coordList(positions: Position[]): string {
  return positions.map(coordStr).join(' ');
}

function geometryXml(geom: Geometry): string {
  switch (geom.type) {
    case 'Point':
      return `<Point><coordinates>${coordStr(geom.coordinates as Position)}</coordinates></Point>`;
    case 'MultiPoint':
      return `<MultiGeometry>${(geom.coordinates as Position[])
        .map((p) => `<Point><coordinates>${coordStr(p)}</coordinates></Point>`)
        .join('')}</MultiGeometry>`;
    case 'LineString':
      return `<LineString><coordinates>${coordList(geom.coordinates as Position[])}</coordinates></LineString>`;
    case 'MultiLineString':
      return `<MultiGeometry>${(geom.coordinates as Position[][])
        .map((line) => `<LineString><coordinates>${coordList(line)}</coordinates></LineString>`)
        .join('')}</MultiGeometry>`;
    case 'Polygon':
      return polygonXml(geom.coordinates as Position[][]);
    case 'MultiPolygon':
      return `<MultiGeometry>${(geom.coordinates as Position[][][])
        .map((p) => polygonXml(p))
        .join('')}</MultiGeometry>`;
    default:
      return '';
  }
}

function polygonXml(rings: Position[][]): string {
  const [outer, ...holes] = rings;
  const inner = holes
    .map(
      (h) =>
        `<innerBoundaryIs><LinearRing><coordinates>${coordList(h)}</coordinates></LinearRing></innerBoundaryIs>`
    )
    .join('');
  return `<Polygon><outerBoundaryIs><LinearRing><coordinates>${coordList(
    outer
  )}</coordinates></LinearRing></outerBoundaryIs>${inner}</Polygon>`;
}

function placemarkXml(feature: Feature): string {
  const props = (feature.properties ?? {}) as Record<string, unknown>;
  const name = escapeXml(props.name ?? props['名称'] ?? '');
  const desc = escapeXml(props.description ?? props['描述'] ?? '');
  const idAttr = feature.id ? ` id="${escapeXml(feature.id)}"` : '';
  return `<Placemark${idAttr}><name>${name}</name><description>${desc}</description>${geometryXml(
    feature.geometry as Geometry
  )}</Placemark>`;
}

/** GeoJSON -> KML 字符串 */
export function geoJSONToKML(fc: FeatureCollection, docName?: string): string {
  const title = escapeXml(docName ?? 'GeoTransformer-export');
  const placemarks = fc.features.map((f) => (f as Feature).geometry ? placemarkXml(f as Feature) : '').join('\n');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">\n` +
    `<Document>\n<name>${title}</name>\n<Folder>\n${placemarks}\n</Folder>\n</Document>\n</kml>`
  );
}

/* --------------------------- 就地改写 KML 坐标 --------------------------- */

/**
 * 在原始 KML 文本上就地改写坐标，不经过 GeoJSON。
 *
 * 为什么需要它：KML -> GeoJSON -> KML 的往返会丢失结构 —— `gx:Track` 退化成单点或
 * 普通 LineString、`<when>` 时间戳 / `<Style>` / `<Folder>` 全部丢弃，导出文件在两步路、
 * Google Earth 等软件里会显示异常。就地改写只替换坐标数字，文档结构原样保留。
 *
 * 同时处理 `<coordinates>lng,lat,alt …</coordinates>` 与 `<gx:coord>lng lat alt</gx:coord>`。
 */

/** "lng,lat" 或 "lng,lat,alt" */
const PAIR_COMMA = new RegExp(`(${NUM_SRC}),(${NUM_SRC})(?:,(${NUM_SRC}))?`, 'g');
/** "lng lat" 或 "lng lat alt"（gx:coord） */
const PAIR_SPACE = new RegExp(`(${NUM_SRC})\\s+(${NUM_SRC})(?:\\s+(${NUM_SRC}))?`, 'g');

function shiftPair(
  shift: CoordShift,
  lngSrc: string,
  latSrc: string,
  altSrc: string | undefined,
  sep: string,
  whole: string,
  dropAlt: boolean
): string {
  const lng = Number(lngSrc);
  const lat = Number(latSrc);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return whole;
  const [x, y] = shift(lng, lat);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return whole;
  // 丢弃高程时只保留经纬度；否则高程原样保留，不做任何换算
  if (dropAlt) return `${fmtNum(x)}${sep}${fmtNum(y)}`;
  return altSrc === undefined
    ? `${fmtNum(x)}${sep}${fmtNum(y)}`
    : `${fmtNum(x)}${sep}${fmtNum(y)}${sep}${altSrc}`;
}

/** 改写一段 <coordinates> 文本（点之间以空白分隔） */
function shiftCoordinatesText(text: string, shift: CoordShift, dropAlt: boolean): string {
  return text.replace(PAIR_COMMA, (m, lngSrc: string, latSrc: string, altSrc?: string) =>
    shiftPair(shift, lngSrc, latSrc, altSrc, ',', m, dropAlt)
  );
}

/** 改写一段 <gx:coord> 文本（以空白分隔的三元组） */
function shiftGxCoordText(text: string, shift: CoordShift, dropAlt: boolean): string {
  return text.replace(PAIR_SPACE, (m, lngSrc: string, latSrc: string, altSrc?: string) =>
    shiftPair(shift, lngSrc, latSrc, altSrc, ' ', m, dropAlt)
  );
}

/** 兜底：XML 无法解析（如 description 里有未定义实体）时，直接按标签名做正则替换 */
function shiftByRegex(text: string, shift: CoordShift, dropAlt: boolean): string {
  return text
    .replace(
      /(<(?:[\w.-]+:)?coordinates\b[^>]*>)([\s\S]*?)(<\/(?:[\w.-]+:)?coordinates>)/gi,
      (_m, open: string, body: string, close: string) =>
        open + shiftCoordinatesText(body, shift, dropAlt) + close
    )
    .replace(
      /(<(?:[\w.-]+:)?coord\b[^>]*>)([\s\S]*?)(<\/(?:[\w.-]+:)?coord>)/gi,
      (_m, open: string, body: string, close: string) => open + shiftGxCoordText(body, shift, dropAlt) + close
    );
}

export interface KmlConvertOptions {
  /** 丢弃高程（输出二维），便于 GIS 软件按 2D 处理 */
  dropAltitude?: boolean;
}

/**
 * KML 文本 -> 偏移后的 KML 文本，保留全部文档结构。
 * 找不到任何坐标节点时抛错，交由调用方决定如何处理。
 */
export function convertKmlText(
  text: string,
  shift: CoordShift,
  options: KmlConvertOptions = {}
): string {
  const dropAlt = options.dropAltitude === true;
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  const broken = doc.querySelector('parsererror');

  if (!broken && doc.documentElement) {
    const coordEls: Element[] = [];
    const gxEls: Element[] = [];
    collectByLocalName(doc.documentElement, 'coordinates', coordEls);
    collectByLocalName(doc.documentElement, 'coord', gxEls);
    for (const e of coordEls) e.textContent = shiftCoordinatesText(e.textContent ?? '', shift, dropAlt);
    for (const e of gxEls) e.textContent = shiftGxCoordText(e.textContent ?? '', shift, dropAlt);
    const touched = coordEls.length + gxEls.length;
    if (touched > 0) {
      return serializeXmlDoc(doc, hasXmlDecl(text));
    }
  }

  // 走正则兜底
  const out = shiftByRegex(text, shift, dropAlt);
  if (out === text) throw new Error('未在 KML 中找到 <coordinates> 或 <gx:coord> 坐标节点');
  return out;
}

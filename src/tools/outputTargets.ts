import type { AppServices } from '@/toolRegistry';
import type { Parsed, SourceType } from '@/tools/fileParsers';
import { checkLngLatRange, rangeErrorHint } from '@/core/coordBounds';
import { geoJSONToShapefile } from '@/format/shapefile';
import { geoJSONToKML } from '@/format/kml';
import { geoJSONToTopoJSONString } from '@/format/topojson';
import { geoJSONToWKT } from '@/format/wkt';
import { geoJSONToWKBHex } from '@/format/wkb';
import { geoJSONToGPX } from '@/format/gpx';
import { geoJSONToGML } from '@/format/gml';
import { geoJSONToDXF } from '@/format/dxf';
import { geoJSONToOsmXml } from '@/format/osmxml';
import { geoJSONToFlatCSV, geoJSONToAttrCSV } from '@/format/csvFlat';

/**
 * 输出格式清单与写出逻辑。供「格式转换」与「坐标投影转换」共用，
 * 保证两个工具的可选目标格式始终一致。
 */

export type TargetType =
  | 'GeoJSON'
  | 'Shapefile'
  | 'KML'
  | 'TopoJSON'
  | 'WKT'
  | 'WKB'
  | 'GPX'
  | 'GML'
  | 'DXF'
  | 'OSM'
  | 'CSV'
  | 'AttrCSV';

export const TARGETS: { value: TargetType; label: string }[] = [
  { value: 'GeoJSON', label: 'GeoJSON (.geojson)' },
  { value: 'Shapefile', label: 'Shapefile (.zip)' },
  { value: 'KML', label: 'KML (.kml)' },
  { value: 'TopoJSON', label: 'TopoJSON (.topojson)' },
  { value: 'WKT', label: 'WKT 文本 (.wkt)' },
  { value: 'WKB', label: 'WKB 十六进制 (.wkb)' },
  { value: 'GPX', label: 'GPX 轨迹 (.gpx)' },
  { value: 'GML', label: 'GML (.gml)' },
  { value: 'DXF', label: 'DXF CAD (.dxf)' },
  { value: 'OSM', label: 'OSM XML (.osm)' },
  { value: 'CSV', label: 'CSV 扁平表 (.csv)' },
  { value: 'AttrCSV', label: 'CSV 属性表 (.csv)' },
];

/** 目标格式的中文名（不含扩展名），用于提示文案 */
export function targetLabel(target: TargetType): string {
  return TARGETS.find((t) => t.value === target)?.label ?? target;
}

/**
 * 按规范只接受经纬度（度）的格式。
 * KML / GPX / OSM XML 的坐标规范都是 WGS-84 经纬度，写入投影坐标（米）会产出无法使用的文件。
 */
export const DEGREE_ONLY_TARGETS: TargetType[] = ['KML', 'GPX', 'OSM'];

/** 该格式是否要求经纬度坐标 */
export function requiresLngLat(target: TargetType): boolean {
  return DEGREE_ONLY_TARGETS.includes(target);
}

/**
 * 写出前的坐标格式校验。
 * 抛出明确错误，避免静默生成「打不开 / 位置错误」的文件。
 */
export function assertWritableCoords(fc: Parsed['fc'], target: TargetType): void {
  if (!requiresLngLat(target)) return;
  const check = checkLngLatRange(fc);
  if (check.ok) return;
  throw new Error(
    `${rangeErrorHint(check)}，而 ${targetLabel(target).split(' ')[0]} 只能表示经纬度。` +
      `请先转换到地理坐标系（如 EPSG:4326 / WGS84），或改用 GeoJSON / Shapefile / WKT 等格式。`
  );
}

/** 源格式天然对应的输出格式；没有对应写出器时返回 null（调用方回退到 GeoJSON） */
const SOURCE_TARGET: Record<SourceType, TargetType | null> = {
  GeoJSON: 'GeoJSON',
  Shapefile: 'Shapefile',
  KML: 'KML',
  GPX: 'GPX',
  GML: 'GML',
  DXF: 'DXF',
  OSM: 'OSM',
  WKT: 'WKT',
  WKB: 'WKB',
  CSV: 'CSV',
  TopoJSON: 'TopoJSON',
  Excel: 'CSV', // 无 Excel 写出器，落回等价的扁平淡表
  PostGIS: 'GeoJSON',
};

/** 输入什么格式，默认输出什么格式 */
export function sourceTargetOf(sourceType: SourceType): TargetType {
  return SOURCE_TARGET[sourceType] ?? 'GeoJSON';
}

/** 把解析结果按目标格式写出并触发下载 */
export async function writeTarget(
  parsed: Parsed,
  target: TargetType,
  svc: AppServices
): Promise<void> {
  assertWritableCoords(parsed.fc, target);
  const base = parsed.fileName.replace(/\.[^.]+$/, '') || 'export';
  switch (target) {
    case 'GeoJSON':
      svc.downloadGeoJSON(parsed.fc, base + '.geojson');
      break;
    case 'KML':
      svc.downloadText(geoJSONToKML(parsed.fc, base), base + '.kml', 'application/vnd.google-earth.kml+xml');
      break;
    case 'TopoJSON':
      svc.downloadText(geoJSONToTopoJSONString(parsed.fc), base + '.topojson', 'application/json');
      break;
    case 'WKT':
      svc.downloadText(geoJSONToWKT(parsed.fc), base + '.wkt', 'text/plain');
      break;
    case 'WKB':
      svc.downloadText(geoJSONToWKBHex(parsed.fc), base + '.wkb', 'text/plain');
      break;
    case 'GPX':
      svc.downloadText(geoJSONToGPX(parsed.fc, base), base + '.gpx', 'application/gpx+xml');
      break;
    case 'GML':
      svc.downloadText(geoJSONToGML(parsed.fc, base), base + '.gml', 'application/gml+xml');
      break;
    case 'DXF':
      svc.downloadText(geoJSONToDXF(parsed.fc), base + '.dxf', 'application/dxf');
      break;
    case 'OSM':
      svc.downloadText(geoJSONToOsmXml(parsed.fc), base + '.osm', 'text/xml');
      break;
    case 'CSV':
      svc.downloadText(geoJSONToFlatCSV(parsed.fc), base + '.csv', 'text/csv');
      break;
    case 'AttrCSV':
      svc.downloadText(geoJSONToAttrCSV(parsed.fc), base + '-属性.csv', 'text/csv');
      break;
    case 'Shapefile': {
      const blob = await geoJSONToShapefile(parsed.fc, base);
      svc.downloadBlob(blob, `${base}-shapefile.zip`);
      break;
    }
  }
}

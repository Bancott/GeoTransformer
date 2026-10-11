import type { Feature, FeatureCollection } from 'geojson';
import { parseGeoJSONString, stats, getBounds } from '@/format';
import { kmlToGeoJSON } from '@/format/kml';
import { gpxToGeoJSON } from '@/format/gpx';
import { gmlToGeoJSON } from '@/format/gml';
import { dxfToGeoJSON } from '@/format/dxf';
import { osmXmlToGeoJSON } from '@/format/osmxml';
import { wktToGeoJSON } from '@/format/wkt';
import { wkbToGeoJSON } from '@/format/wkb';
import { postgisToGeoJSON } from '@/format/postgis';
import { csvToGeoJSON } from '@/format/csv';
import { shapefileToGeoJSON, shapefilePartsToGeoJSON } from '@/format/shapefile';
import { topoJSONToGeoJSON } from '@/format/topojson';
import { excelToGeoJSON } from '@/format/excel';
import { readFileText, readFileBuffer } from '@/ui/dropzone';

export type SourceType =
  | 'GeoJSON'
  | 'Shapefile'
  | 'KML'
  | 'GPX'
  | 'GML'
  | 'DXF'
  | 'OSM'
  | 'WKT'
  | 'WKB'
  | 'CSV'
  | 'TopoJSON'
  | 'Excel'
  | 'PostGIS';

export interface Parsed {
  fc: FeatureCollection;
  fileName: string;
  size: number;
  sourceType: SourceType;
  count: number;
  geometryTypes: string[];
  coordCount: number;
  bbox: [number, number, number, number];
  /** 原始文本，仅 KML / GPX 保留：用于「就地改写坐标」以保住文档结构 */
  rawText?: string;
}

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

function sniffKind(text: string): SourceType | null {
  const t = text.trim();
  if (!t) return null;
  if (t.startsWith('{')) return text.includes('"type":"Topology"') || text.includes('Topology') ? 'TopoJSON' : 'GeoJSON';
  if (/^<[^>]*osm[ >]/i.test(t)) return 'OSM';
  if (/^<[^>]*gpx/i.test(t)) return 'GPX';
  if (/^<[^>]*kml/i.test(t)) return 'KML';
  if (/<[^>]*gml:|\bGML\b|FeatureCollection/.test(t)) return 'GML';
  if (/^0\s*\n\s*(SECTION|ENTITIES)/i.test(t) || /^\s*SECTION/.test(t)) return 'DXF';
  if (/^(POINT|LINESTRING|POLYGON|MULTI|GEOMETRYCOLLECTION)\s*\(/i.test(t)) return 'WKT';
  if (/^[0-9a-fA-F]{18,}$/s.test(t.replace(/\s/g, ''))) return 'WKB';
  if (/COPY\s+\S+\s*\(.*from\s+stdin/i.test(t)) return 'PostGIS';
  if (t.includes(',') || t.includes('\t')) return 'CSV';
  return null;
}

function getGeometryFromUnknown(text: string): { fc: FeatureCollection; sourceType: SourceType } {
  const kind = sniffKind(text);
  switch (kind) {
    case 'KML':
      return { fc: kmlToGeoJSON(text), sourceType: 'KML' };
    case 'GPX':
      return { fc: gpxToGeoJSON(text), sourceType: 'GPX' };
    case 'GML':
      return { fc: gmlToGeoJSON(text), sourceType: 'GML' };
    case 'OSM':
      return { fc: osmXmlToGeoJSON(text), sourceType: 'OSM' };
    case 'DXF':
      return { fc: dxfToGeoJSON(text), sourceType: 'DXF' };
    case 'WKT':
      return { fc: wktToGeoJSON(text), sourceType: 'WKT' };
    case 'WKB':
      return { fc: wkbToGeoJSON(text.replace(/\s/g, '')), sourceType: 'WKB' };
    case 'PostGIS':
      return { fc: postgisToGeoJSON(text), sourceType: 'PostGIS' };
    case 'CSV':
      return { fc: csvToGeoJSON(text), sourceType: 'CSV' };
    case 'TopoJSON': {
      const data = JSON.parse(text) as { type?: string };
      return { fc: topoJSONToGeoJSON(data as never), sourceType: 'TopoJSON' };
    }
    case 'GeoJSON':
      return { fc: parseGeoJSONString(text), sourceType: 'GeoJSON' };
    default:
      throw new Error('无法识别的文件格式');
  }
}

/** 把上传的文件解析为统一的 FeatureCollection */
export async function parseToFeatureCollection(file: File): Promise<Parsed> {
  const fileName = file.name;
  const ext = extOf(fileName);
  let fc: FeatureCollection;
  let sourceType: SourceType;
  let rawText: string | undefined;

  if (ext === 'zip') {
    fc = await shapefileToGeoJSON(await readFileBuffer(file));
    sourceType = 'Shapefile';
  } else if (ext === 'shp') {
    // 只有 .shp 时能读出几何，属性为空（配套 .dbf 需一起拖入）
    fc = await shapefilePartsToGeoJSON({
      shp: await readFileBuffer(file),
      name: baseName(fileName) || 'layer',
    });
    sourceType = 'Shapefile';
  } else if (ext === 'dbf' || ext === 'shx' || ext === 'prj' || ext === 'cpg') {
    throw new Error(
      `.${ext} 是 Shapefile 的组成部分，需要和同名的 .shp 一起拖入（也可以把整套文件压缩成 .zip）。`
    );
  } else if (ext === 'xlsx' || ext === 'xls') {    fc = await excelToGeoJSON(await readFileBuffer(file));
    sourceType = 'Excel';
  } else if (ext === 'kml') {
    rawText = await readFileText(file);
    fc = await kmlToGeoJSON(rawText);
    sourceType = 'KML';
  } else if (ext === 'gpx' || ext === 'gpx.xml') {
    rawText = await readFileText(file);
    fc = await gpxToGeoJSON(rawText);
    sourceType = 'GPX';
  } else if (ext === 'gml' || ext === 'xml' && fileName.toLowerCase().includes('gml')) {
    fc = await gmlToGeoJSON(await readFileText(file));
    sourceType = 'GML';
  } else if (ext === 'dxf') {
    fc = await dxfToGeoJSON(await readFileText(file));
    sourceType = 'DXF';
  } else if (ext === 'osm') {
    fc = await osmXmlToGeoJSON(await readFileText(file));
    sourceType = 'OSM';
  } else if (ext === 'wkt') {
    fc = await wktToGeoJSON(await readFileText(file));
    sourceType = 'WKT';
  } else if (ext === 'wkb') {
    const text = await readFileText(file);
    fc = wkbToGeoJSON(text.trim());
    sourceType = 'WKB';
  } else if (ext === 'csv' || ext === 'tsv') {
    fc = csvToGeoJSON(await readFileText(file));
    sourceType = 'CSV';
  } else if (ext === 'json' || ext === 'geojson' || ext === 'topojson') {
    const text = await readFileText(file);
    const data = JSON.parse(text) as { type?: string };
    if (data?.type === 'Topology') {
      fc = topoJSONToGeoJSON(data as never);
      sourceType = 'TopoJSON';
    } else {
      fc = parseGeoJSONString(text);
      sourceType = 'GeoJSON';
    }
  } else {
    // 依据内容嗅探
    const text = await readFileText(file);
    const kind = sniffKind(text);
    if (kind === 'CSV') {
      fc = csvToGeoJSON(text);
      sourceType = 'CSV';
    } else {
      const resolved = getGeometryFromUnknown(text);
      fc = resolved.fc;
      sourceType = resolved.sourceType;
    }
    // 嗅探出的 KML / GPX 同样保留原文，便于就地改写
    if (sourceType === 'KML' || sourceType === 'GPX') rawText = text;
  }

  if (!fc || !Array.isArray(fc.features)) throw new Error('解析结果为空');
  return buildParsed(fc, fileName, file.size, sourceType, rawText);
}

/* ------------------------- 多文件（Shapefile 组件） ------------------------- */

/** 去掉扩展名的基名，用于把同一 Shapefile 的组件归到一组 */
function baseName(name: string): string {
  const i = name.lastIndexOf('.');
  return (i >= 0 ? name.slice(0, i) : name).toLowerCase();
}

/**
 * 解析**一组**文件。Shapefile 由 .shp/.dbf/.shx/.prj/.cpg 多个文件组成，
 * 必须成组拼装才能得到几何 + 属性；单文件时退化为普通解析。
 */
export async function parseFilesToFeatureCollection(files: File[]): Promise<Parsed> {
  const real = files.filter((f) => f && f.name);
  if (real.length === 0) throw new Error('没有选择文件');
  if (real.length === 1) return parseToFeatureCollection(real[0]);

  // 按基名分组，只保留含 .shp 的组
  const groups = new Map<string, Map<string, File>>();
  for (const f of real) {
    const ext = extOf(f.name);
    const key = baseName(f.name);
    if (!groups.has(key)) groups.set(key, new Map());
    groups.get(key)!.set(ext, f);
  }
  const shpGroups = Array.from(groups.entries()).filter(([, parts]) => parts.has('shp'));

  if (shpGroups.length === 0) {
    const named = real.map((f) => f.name).join('、');
    throw new Error(
      `一次拖入多个文件时，需要包含 Shapefile 的 .shp 组件（配套 .dbf/.shx/.prj 可选）。` +
        `收到的文件：${named}。也可以把整套文件压缩成一个 .zip 后拖入。`
    );
  }

  const merged: Feature[] = [];
  let size = 0;
  for (const [key, parts] of shpGroups) {
    const shpFile = parts.get('shp')!;
    const dbfFile = parts.get('dbf');
    const shxFile = parts.get('shx');
    const prjFile = parts.get('prj');
    const cpgFile = parts.get('cpg');
    size += Array.from(parts.values()).reduce((sum, f) => sum + f.size, 0);
    const fc = await shapefilePartsToGeoJSON({
      name: key || 'layer',
      shp: await readFileBuffer(shpFile),
      dbf: dbfFile ? await readFileBuffer(dbfFile) : undefined,
      shx: shxFile ? await readFileBuffer(shxFile) : undefined,
      prj: prjFile ? await readFileText(prjFile) : undefined,
      cpg: cpgFile ? await readFileBuffer(cpgFile) : undefined,
    });
    merged.push(...(fc.features as Feature[]));
  }

  const label =
    shpGroups.length === 1
      ? shpGroups[0][1].get('shp')!.name
      : `${shpGroups.length} 个 Shapefile`;
  return buildParsed({ type: 'FeatureCollection', features: merged }, label, size, 'Shapefile');
}

/** 统一的解析结果装配 */
function buildParsed(
  fc: FeatureCollection,
  fileName: string,
  size: number,
  sourceType: SourceType,
  rawText?: string
): Parsed {
  if (!fc || !Array.isArray(fc.features)) throw new Error('解析结果为空');
  if (fc.features.length === 0) throw new Error('文件里没有可用的要素');
  const st = stats(fc);
  return {
    fc,
    fileName,
    size,
    sourceType,
    count: st.count,
    geometryTypes: st.types,
    coordCount: st.coordCount,
    bbox: getBounds(fc),
    rawText,
  };
}

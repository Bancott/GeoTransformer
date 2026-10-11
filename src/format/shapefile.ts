import shp from 'shpjs';
import JSZip from 'jszip';
import type { FeatureCollection, Feature } from 'geojson';
import { writeShapefileZip } from '@/format/shpWrite';

/** 读取 .shp（单个文件 buffer）或 .zip（内含 .shp）为 GeoJSON */
export async function shapefileToGeoJSON(buffer: ArrayBuffer): Promise<FeatureCollection> {  const source: unknown = buffer instanceof ArrayBuffer ? buffer : (buffer as ArrayBuffer);
  let result: unknown;
  try {
    // 兼容 zip 与单文件
    const data = source as ArrayBuffer;
    result =
      typeof (shp as unknown as { parseZip: (b: ArrayBuffer) => Promise<unknown> }).parseZip === 'function'
        ? await (shp as unknown as { parseZip: (b: ArrayBuffer) => Promise<unknown> }).parseZip(data)
        : await shp(data);
  } catch (err) {
    // 有些单 .shp 无法用 parseZip，退回普通解析
    try {
      result = await shp(source as never);
    } catch (e) {
      throw new Error('Shapefile 解析失败：' + (e as Error).message);
    }
    void err;
  }
  return normalizeToFC(result);
}

function normalizeToFC(input: unknown): FeatureCollection {
  if (!input || typeof input !== 'object') throw new Error('Shapefile 结果为空');
  const obj = input as Record<string, unknown>;
  // 单图层 FeatureCollection
  if (obj.type === 'FeatureCollection') {
    return obj as unknown as FeatureCollection;
  }
  // 多图层：{ layerName: FeatureCollection }
  if (obj.type === 'Feature') {
    return { type: 'FeatureCollection', features: [obj as unknown as Feature] };
  }
  const feats: Feature[] = [];
  for (const key of Object.keys(obj)) {
    const val = obj[key] as FeatureCollection;
    if (val && val.type === 'FeatureCollection' && Array.isArray(val.features)) {
      feats.push(...val.features);
    }
  }
  if (feats.length) return { type: 'FeatureCollection', features: feats };
  throw new Error('无法从 Shapefile 中提取要素');
}

/** Shapefile 的各个组成文件 */
export interface ShapefileParts {
  /** .shp（必需） */
  shp: ArrayBuffer;
  /** 组件基名（决定 zip 内的文件名，需保持一致） */
  name?: string;
  /** .dbf（属性表，可选） */
  dbf?: ArrayBuffer;
  /** .shx（索引，可选） */
  shx?: ArrayBuffer;
  /**
   * .prj（坐标参考，文本）。
   * 当前实现**不把它交给解析器**（见 shapefilePartsToGeoJSON 的说明），
   * 保留字段是为了让调用方完整传递组件，将来可用于自动识别源坐标系。
   */
  prj?: string;
  /** .cpg（属性编码，可选） */
  cpg?: ArrayBuffer;
}

/**
 * 由 **Shapefile 的各个组件** 拼装 GeoJSON。
 *
 * Shapefile 不是单个文件：几何在 .shp、属性在 .dbf、索引用 .shx、坐标系在 .prj。
 * 用户把这一组文件一起拖进来时，这里把它们装进一个内存 zip 再走 `parseZip`
 * —— 与「拖入 zip」完全同一条解析路径，行为一致、无需依赖 shpjs 的底层函数
 * （已安装的是 shpjs v6，而 @types/shpjs 仍是 v3 的声明，`parseShp/combine` 并不存在）。
 */
export async function shapefilePartsToGeoJSON(parts: ShapefileParts): Promise<FeatureCollection> {
  const zip = new JSZip();
  const base = parts.name ?? 'layer';
  zip.file(`${base}.shp`, parts.shp);
  if (parts.dbf) zip.file(`${base}.dbf`, parts.dbf);
  if (parts.shx) zip.file(`${base}.shx`, parts.shx);
  if (parts.cpg) zip.file(`${base}.cpg`, parts.cpg);
  // 刻意**不**把 .prj 交给解析器：本工具不使用它（坐标系由用户在界面上明确指定），
  // 而现实中不少 .prj 是过时或不规范的 WKT，会让整个解析直接失败。
  const buffer = await zip.generateAsync({ type: 'arraybuffer' });
  return shapefileToGeoJSON(buffer);
}

/**
 * GeoJSON -> Shapefile ZIP（Blob）。
 *
 * 用自实现的写出器（`shpWrite.ts`）：@mapbox/shp-write 会把**所有 LineString
 * 合并成一条多段记录**，导致多条线并成一个 MultiLineString、属性表只剩第一行 ——
 * 对等高线这类「每条线各带属性」的数据是数据丢失。
 */
export async function geoJSONToShapefile(fc: FeatureCollection, fileName = 'layer'): Promise<Blob> {
  // 保证所有要素都有 properties，避免写出崩溃
  const padded: FeatureCollection = {
    type: 'FeatureCollection',
    features: fc.features.map((f) => ({
      ...(f as Feature),
      properties: (f as Feature).properties ?? {},
    })),
  };
  return writeShapefileZip(padded, fileName);
}

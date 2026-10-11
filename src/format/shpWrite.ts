import JSZip from 'jszip';
import type { Feature, FeatureCollection, Geometry, Position } from 'geojson';
import { fmtNum } from '@/format/xmlText';

/**
 * Shapefile 写出（自实现）。
 *
 * 为什么不用 @mapbox/shp-write：它把**所有 LineString 合并成一条多段记录**
 * （见其 src/geojson.js 对 POLYLINE 的特判），导致多条线被并成一个 MultiLineString、
 * 属性表只保留第一行 —— 对「等高线」这类每条线各带高程的数据是致命的数据丢失。
 * 这里按要素逐条写记录，保证要素数、属性与几何类型一一对应。
 *
 * 支持的几何：Point / MultiPoint / LineString / MultiLineString / Polygon / MultiPolygon。
 * 输出为 zip，内含 .shp（几何）+ .shx（索引）+ .dbf（属性）+ .cpg（编码）。
 * 不写 .prj —— GCJ-02 / 火星墨卡托等没有权威 WKT，写错比不写更糟，请在 GIS 中手动指定坐标系。
 */

const SHP_POINT = 1;
const SHP_POLYLINE = 3;
const SHP_POLYGON = 5;
const SHP_MULTIPOINT = 8;

interface ShpRecord {
  /** 各 part 的点序列（点要素为一个 part） */
  parts: Position[][];
  props: Record<string, unknown>;
}

type Category = 'point' | 'line' | 'polygon';

const CATEGORY_OF: Partial<Record<Geometry['type'], Category>> = {
  Point: 'point',
  MultiPoint: 'point',
  LineString: 'line',
  MultiLineString: 'line',
  Polygon: 'polygon',
  MultiPolygon: 'polygon',
};

function ringOf(coords: Position[]): Position[] {
  return coords.map((p) => [Number(p[0]), Number(p[1])]);
}

/** 有向面积（>0 为逆时针） */function signedArea(ring: Position[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum / 2;
}

/** 按 ESRI 约定调整环绕方向：外环顺时针（负面积）、洞逆时针 */
function orient(ring: Position[], clockwise: boolean): Position[] {
  const isCw = signedArea(ring) < 0;
  return isCw === clockwise ? ring : ring.slice().reverse();
}

/** 把一个要素规范化为「若干 part」；无法表达的类型返回 null */
function toParts(geometry: Geometry | null): { parts: Position[][]; polygonFlags?: boolean[] } | null {
  if (!geometry) return null;
  const pair = (p: Position): Position => [Number(p[0]), Number(p[1])];
  /** 多边形环需闭合（GeoJSON 规范已闭合，这里兜底） */
  const ringClosed = (coords: Position[]): Position[] => {
    const ring = ringOf(coords);
    if (ring.length >= 3) {
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
    }
    return ring;
  };

  switch (geometry.type) {
    case 'Point':
      return { parts: [[pair(geometry.coordinates as Position)]] };
    case 'MultiPoint':
      // 每个点一个 part：记录类型会自动升为 MULTIPOINT
      return { parts: (geometry.coordinates as Position[]).map((p) => [pair(p)]) };
    case 'LineString':
      return { parts: [ringOf(geometry.coordinates as Position[])] };
    case 'MultiLineString':
      return { parts: (geometry.coordinates as Position[][]).map(ringOf) };
    case 'Polygon': {
      const rings = geometry.coordinates as Position[][];
      return { parts: rings.map(ringClosed), polygonFlags: rings.map((_r, i) => i === 0) };
    }
    case 'MultiPolygon': {
      const parts: Position[][] = [];
      const polygonFlags: boolean[] = [];
      for (const poly of geometry.coordinates as Position[][][]) {
        poly.forEach((ring, i) => {
          parts.push(ringClosed(ring));
          polygonFlags.push(i === 0);
        });
      }
      return { parts, polygonFlags };
    }
    default:
      return null;
  }
}

/* --------------------------------- SHP --------------------------------- */

function bbox(records: ShpRecord[]): [number, number, number, number] {
  let xmin = Infinity;
  let ymin = Infinity;
  let xmax = -Infinity;
  let ymax = -Infinity;
  for (const r of records) {
    for (const part of r.parts) {
      for (const p of part) {
        if (p[0] < xmin) xmin = p[0];
        if (p[0] > xmax) xmax = p[0];
        if (p[1] < ymin) ymin = p[1];
        if (p[1] > ymax) ymax = p[1];
      }
    }
  }
  if (!Number.isFinite(xmin)) return [0, 0, 0, 0];
  return [xmin, ymin, xmax, ymax];
}

/** 单条记录的字节数（含 8 字节记录头） */
function recordBytes(shapeType: number, record: ShpRecord): number {
  const pointCount = record.parts.reduce((n, part) => n + part.length, 0);
  if (shapeType === SHP_POINT) return 8 + 4 + 16;
  if (shapeType === SHP_MULTIPOINT) return 8 + 4 + 32 + 4 + pointCount * 16;
  // POLYLINE / POLYGON
  return 8 + 4 + 32 + 4 + 4 + record.parts.length * 4 + pointCount * 16;
}

function writeShp(shapeType: number, records: ShpRecord[]): ArrayBuffer {
  const total = 100 + records.reduce((n, r) => n + recordBytes(shapeType, r), 0);
  const buf = new ArrayBuffer(total);
  const view = new DataView(buf);

  // ---- 文件头（100 字节）----
  view.setInt32(0, 9994, false); // 文件码
  view.setInt32(24, total / 2, false); // 文件长度（16 位字）
  view.setInt32(28, 1000, true); // 版本
  view.setInt32(32, shapeType, true);
  const [xmin, ymin, xmax, ymax] = bbox(records);
  view.setFloat64(36, xmin, true);
  view.setFloat64(44, ymin, true);
  view.setFloat64(52, xmax, true);
  view.setFloat64(60, ymax, true);
  // 68..99：Z/M 范围，2D 类型留 0

  // ---- 记录 ----
  let offset = 100;
  records.forEach((record, index) => {
    const contentBytes = recordBytes(shapeType, record) - 8;
    view.setInt32(offset, index + 1, false); // 记录号（从 1 开始）
    view.setInt32(offset + 4, contentBytes / 2, false); // 内容长度（16 位字）
    let p = offset + 8;
    view.setInt32(p, shapeType, true);
    p += 4;

    const points = record.parts.flat();
    if (shapeType !== SHP_POINT) {
      const box = bbox([record]);
      view.setFloat64(p, box[0], true);
      view.setFloat64(p + 8, box[1], true);
      view.setFloat64(p + 16, box[2], true);
      view.setFloat64(p + 24, box[3], true);
      p += 32;

      if (shapeType === SHP_MULTIPOINT) {
        view.setInt32(p, points.length, true);
        p += 4;
      } else {
        view.setInt32(p, record.parts.length, true); // NumParts
        view.setInt32(p + 4, points.length, true); // NumPoints
        p += 8;
        let start = 0;
        for (const part of record.parts) {
          view.setInt32(p, start, true); // 每个 part 的起始点索引
          p += 4;
          start += part.length;
        }
      }
    }

    for (const point of points) {
      view.setFloat64(p, point[0], true);
      view.setFloat64(p + 8, point[1], true);
      p += 16;
    }
    offset += recordBytes(shapeType, record);
  });

  return buf;
}

function writeShx(shapeType: number, records: ShpRecord[]): ArrayBuffer {
  const buf = new ArrayBuffer(100 + records.length * 8);
  const view = new DataView(buf);
  view.setInt32(0, 9994, false);
  view.setInt32(24, (100 + records.length * 8) / 2, false);
  view.setInt32(28, 1000, true);
  view.setInt32(32, shapeType, true);
  const [xmin, ymin, xmax, ymax] = bbox(records);
  view.setFloat64(36, xmin, true);
  view.setFloat64(44, ymin, true);
  view.setFloat64(52, xmax, true);
  view.setFloat64(60, ymax, true);

  let offset = 100;
  records.forEach((record, i) => {
    const bytes = recordBytes(shapeType, record);
    view.setInt32(100 + i * 8, offset / 2, false); // 偏移（16 位字）
    view.setInt32(104 + i * 8, (bytes - 8) / 2, false); // 内容长度（16 位字）
    offset += bytes;
  });
  return buf;
}

/* --------------------------------- DBF --------------------------------- */

interface FieldDef {
  /** DBF 中的字段名（最长 10 字节） */
  name: string;
  /** 原始属性键，用于取值 */
  key: string;
  type: 'C' | 'N';
  length: number;
  decimals: number;
}

/** DBF 数字字段的最大宽度（dBASE 限制 18） */
const NUM_MAX_WIDTH = 18;
/** DBF 字符字段的最大宽度（字节） */
const CHAR_MAX_WIDTH = 254;

const encoder = new TextEncoder();
/** DBF 的宽度单位是**字节**，中文一个字占 3 字节，必须按 UTF-8 字节数计算 */
function utf8Length(s: string): number {
  return encoder.encode(s).length;
}

/** 按字节截断（不切断多字节字符） */
function cutBytes(s: string, maxBytes: number): Uint8Array {
  const all = encoder.encode(s);
  if (all.length <= maxBytes) return all;
  let end = maxBytes;
  // UTF-8 续字节形如 10xxxxxx，回退到字符边界
  while (end > 0 && (all[end] & 0xc0) === 0x80) end--;
  return all.subarray(0, end);
}

/** 从属性推断字段定义（同名合并；全为数字的用 N，其余用 C） */
function inferFields(records: ShpRecord[]): FieldDef[] {
  const keys: string[] = [];
  for (const r of records) {
    for (const k of Object.keys(r.props ?? {})) {
      if (!keys.includes(k)) keys.push(k);
    }
  }

  return keys.slice(0, 200).map((key) => {
    const name = new TextDecoder().decode(cutBytes(key, 10));
    const values = records.map((r) => r.props?.[key]);
    const isBlank = (v: unknown): boolean => v === null || v === undefined || v === '';
    const textOf = (v: unknown): string =>
      typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);
    const allNumber = values.every((v) => isBlank(v) || typeof v === 'number');

    if (allNumber && values.some((v) => typeof v === 'number')) {
      const hasFraction = values.some((v) => typeof v === 'number' && !Number.isInteger(v));
      const longest = Math.max(
        ...values.map((v) => (typeof v === 'number' ? fmtNum(v).length : 0)),
        1
      );
      // 宽度不足时减少小数位，避免数字被截断而失真
      const decimals = hasFraction && longest <= NUM_MAX_WIDTH ? 6 : 0;
      const length = Math.min(NUM_MAX_WIDTH, Math.max(longest, 8));
      return { name, key, type: 'N' as const, length, decimals };
    }

    const longest = Math.max(
      1,
      ...values.map((v) => (isBlank(v) ? 0 : utf8Length(textOf(v))))
    );
    return {
      name,
      key,
      type: 'C' as const,
      length: Math.max(1, Math.min(CHAR_MAX_WIDTH, longest)),
      decimals: 0,
    };
  });
}

function writeDbf(records: ShpRecord[], fields: FieldDef[]): ArrayBuffer {
  const headerLength = 32 + fields.length * 32 + 1;
  const recordLength = 1 + fields.reduce((n, f) => n + f.length, 0);
  const total = headerLength + records.length * recordLength + 1;
  const buf = new ArrayBuffer(total);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  const now = new Date();
  view.setUint8(0, 0x03); // dBASE III
  view.setUint8(1, now.getFullYear() - 1900);
  view.setUint8(2, now.getMonth() + 1);
  view.setUint8(3, now.getDate());
  view.setInt32(4, records.length, true);
  view.setInt16(8, headerLength, true);
  view.setInt16(10, recordLength, true);

  let p = 32;
  for (const f of fields) {
    bytes.set(cutBytes(f.name, 10), p); // 名称最多 10 字节
    view.setUint8(p + 11, f.type.charCodeAt(0));
    view.setUint8(p + 16, f.length);
    view.setUint8(p + 17, f.decimals);
    p += 32;
  }
  view.setUint8(p, 0x0d); // 字段描述结束

  let rp = headerLength;
  for (const record of records) {
    bytes.set([0x20], rp); // 未删除标记
    let fp = rp + 1;
    for (const f of fields) {
      const raw = record.props?.[f.key];
      const text =
        raw === null || raw === undefined
          ? ''
          : typeof raw === 'number'
            ? fmtNum(raw)
            : typeof raw === 'object'
              ? JSON.stringify(raw)
              : String(raw);
      const encoded = cutBytes(text, f.length);
      // 两类字段都先填空格；数字再右对齐覆盖
      for (let i = 0; i < f.length; i++) bytes.set([0x20], fp + i);
      bytes.set(encoded, f.type === 'N' ? fp + f.length - encoded.length : fp);
      fp += f.length;
    }
    rp += recordLength;
  }
  view.setUint8(total - 1, 0x1a); // 文件结束符
  return buf;
}

/* --------------------------------- 组装 --------------------------------- */

const FILE_SUFFIX: Record<Category, string> = { point: 'point', line: 'line', polygon: 'polygon' };
const SHAPE_TYPE: Record<Category, number> = {
  point: SHP_POINT,
  line: SHP_POLYLINE,
  polygon: SHP_POLYGON,
};
/** 该类别是否可能存在多段（决定用 POINT 还是 MULTIPOINT 记录类型） */
function shapeTypeFor(category: Category, records: ShpRecord[]): number {
  if (category === 'point') {
    return records.some((r) => r.parts.length > 1) ? SHP_MULTIPOINT : SHP_POINT;
  }
  return SHAPE_TYPE[category];
}

/** GeoJSON -> Shapefile ZIP（Blob） */
export async function writeShapefileZip(
  fc: FeatureCollection,
  fileName = 'layer'
): Promise<Blob> {
  const buckets: Record<Category, ShpRecord[]> = { point: [], line: [], polygon: [] };
  let skipped = 0;

  for (const f of fc.features as Feature[]) {
    const category = f.geometry ? CATEGORY_OF[f.geometry.type] : undefined;
    if (!category) {
      skipped++;
      continue;
    }
    const normalized = toParts(f.geometry);
    if (!normalized) {
      skipped++;
      continue;
    }
    let parts = normalized.parts.filter((p) => p.length > 0);
    // 多边形按 ESRI 约定调整环绕方向（外环顺时针、洞逆时针）
    if (category === 'polygon' && normalized.polygonFlags) {
      parts = parts.map((ring, i) => orient(ring, normalized.polygonFlags![i] === true));
    }
    if (parts.length === 0) {
      skipped++;
      continue;
    }
    buckets[category].push({
      parts,
      props: (f.properties ?? {}) as Record<string, unknown>,
    });
  }

  const used = (Object.keys(buckets) as Category[]).filter((c) => buckets[c].length > 0);
  if (used.length === 0) {
    throw new Error('没有可写出的几何（支持点 / 线 / 面，GeometryCollection 等暂不支持）');
  }

  const zip = new JSZip();
  for (const category of used) {
    const records = buckets[category];
    const shapeType = shapeTypeFor(category, records);
    const suffix = used.length > 1 ? `_${FILE_SUFFIX[category]}` : '';
    const name = `${fileName}${suffix}`;

    const shp = writeShp(shapeType, records);
    const shx = writeShx(shapeType, records);
    const fields = inferFields(records);
    const dbf = writeDbf(records, fields);

    zip.file(`${name}.shp`, shp);
    zip.file(`${name}.shx`, shx);
    zip.file(`${name}.dbf`, dbf);
    zip.file(`${name}.cpg`, new TextEncoder().encode('UTF-8'));
  }

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

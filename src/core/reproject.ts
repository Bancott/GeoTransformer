import proj4 from 'proj4';
import type { FeatureCollection, Feature, Position } from 'geojson';
import { PROJECTIONS } from '@/core/types';
import { checkLngLatRange, rangeErrorHint } from '@/core/coordBounds';
import { wgs84ToGcj02, gcj02ToWgs84, wgs84ToBd09, bd09ToWgs84 } from '@/core/coordTransform';

/** 复合投影 / 地理基准伪代码（非标准 EPSG，需特殊处理） */
export const GEO_CODE_GCJ = 'GCJ02'; // 火星坐标（地理经纬度）
export const GEO_CODE_BD09 = 'BD09'; // 百度坐标（地理经纬度）
export const MERC_CODE_GCJ = 'GCJ02-WEBMERC'; // 火星墨卡托（GCJ-02 版 Web 墨卡托）
export const MERC_CODE_BD09 = 'BD09-WEBMERC'; // 百度墨卡托（BD-09 版 Web 墨卡托）

const PSEUDO_CODES = [GEO_CODE_GCJ, GEO_CODE_BD09, MERC_CODE_GCJ, MERC_CODE_BD09];

/** 注册所有内置 EPSG 定义，避免重复注册与命名冲突 */
function registerProjections(): void {
  for (const p of PROJECTIONS) {
    if (!proj4.defs(p.code)) proj4.defs(p.code, p.proj4);
  }
}

export function getProjectionDef(code: string) {
  registerProjections();
  return PROJECTIONS.find((p) => p.code === code) ?? { code, name: code, proj4: '' };
}

/**
 * 某个坐标参考【是投影坐标系还是地理坐标系】。
 *
 * 注意：proj4 会把注册的 def 字符串**解析成对象**，`proj4.defs(code)` 返回的是对象
 * （如 `{ projName: 'longlat', ... }`）而非原字符串，因此不能用 `String(def)` 判断，
 * 必须读 `projName` / `projStr` 字段。
 */
export function projectionKind(code: string): 'geographic' | 'projected' | 'unknown' {
  if (code === GEO_CODE_GCJ || code === GEO_CODE_BD09) return 'geographic';
  if (code === MERC_CODE_GCJ || code === MERC_CODE_BD09) return 'projected';

  // 用户可在「自定义投影」里直接填 proj4 字符串，先按字符串判断
  if (/\+?proj=(longlat|latlong|lonlat)\b/i.test(code)) return 'geographic';
  // 其余带 proj= 的原始 proj4 串（如 +proj=merc / +proj=utm）都是投影坐标系
  if (/\bproj=/i.test(code)) return 'projected';

  registerProjections();
  const def = proj4.defs(code) as { projName?: string; projStr?: string } | string | undefined;
  if (def === undefined) return 'unknown';
  const projName = typeof def === 'object' ? def.projName : undefined;
  const projStr = typeof def === 'object' ? def.projStr : String(def);
  if (/^(longlat|latlong|lonlat)$/i.test(projName ?? '')) return 'geographic';
  if (/proj=(longlat|latlong|lonlat)\b/i.test(projStr ?? '')) return 'geographic';
  return 'projected';
}

function isPseudo(code: string): boolean {
  return PSEUDO_CODES.includes(code);
}

function toWgs84(coord: Position, code: string): [number, number] {
  if (code === 'EPSG:4326') return [coord[0], coord[1]];
  switch (code) {
    case GEO_CODE_GCJ:
      return gcj02ToWgs84(coord[0], coord[1]);
    case GEO_CODE_BD09:
      return bd09ToWgs84(coord[0], coord[1]);
    case MERC_CODE_GCJ: {
      const [gcjLng, gcjLat] = proj4('EPSG:3857', 'EPSG:4326', [coord[0], coord[1]] as never) as [number, number];
      return gcj02ToWgs84(gcjLng, gcjLat);
    }
    case MERC_CODE_BD09: {
      const [bdLng, bdLat] = proj4('EPSG:3857', 'EPSG:4326', [coord[0], coord[1]] as never) as [number, number];
      return bd09ToWgs84(bdLng, bdLat);
    }
    default:
      void 0;
  }
  return proj4(code, 'EPSG:4326', [coord[0], coord[1]] as never) as [number, number];
}

function fromWgs84(wgs: [number, number], code: string): [number, number] {
  if (code === 'EPSG:4326') return [wgs[0], wgs[1]];
  switch (code) {
    case GEO_CODE_GCJ:
      return wgs84ToGcj02(wgs[0], wgs[1]);
    case GEO_CODE_BD09:
      return wgs84ToBd09(wgs[0], wgs[1]);
    case MERC_CODE_GCJ: {
      const [gcjLng, gcjLat] = wgs84ToGcj02(wgs[0], wgs[1]);
      return proj4('EPSG:4326', 'EPSG:3857', [gcjLng, gcjLat] as never) as [number, number];
    }
    case MERC_CODE_BD09: {
      const [bdLng, bdLat] = wgs84ToBd09(wgs[0], wgs[1]);
      return proj4('EPSG:4326', 'EPSG:3857', [bdLng, bdLat] as never) as [number, number];
    }
    default:
      void 0;
  }
  return proj4('EPSG:4326', code, [wgs[0], wgs[1]] as never) as [number, number];
}

/** 单个坐标 [x, y]（GeoJSON 顺序：经度/横坐标在前）投影转换 */
export function reprojectCoord(
  coord: Position,
  fromCode: string,
  toCode: string
): Position {
  registerProjections();
  if (fromCode === toCode) return coord;
  if (isPseudo(fromCode) || isPseudo(toCode)) {
    const wgs = toWgs84(coord, fromCode);
    return fromWgs84(wgs, toCode);
  }
  const out = proj4(fromCode, toCode, [coord[0], coord[1]] as never);
  return [out[0], out[1]];
}

function walkArray(arr: unknown[], cb: (pos: number[]) => void): void {
  if (arr.length === 0) return;
  if (typeof arr[0] === 'number' && typeof arr[1] === 'number') {
    cb(arr as number[]);
    return;
  }
  for (const item of arr) {
    if (Array.isArray(item)) walkArray(item, cb);
  }
}

function walkPositions(geom: unknown, cb: (pos: number[]) => void): void {
  if (!geom || typeof geom !== 'object') return;
  const g = geom as { type?: string; coordinates?: unknown; geometries?: unknown[] };
  if (Array.isArray(g.coordinates)) walkArray(g.coordinates, cb);
  else if (g.type === 'GeometryCollection' && Array.isArray(g.geometries)) {
    for (const sub of g.geometries) walkPositions(sub, cb);
  }
}

export interface ReprojectOptions {
  /** 是否在属性里标记来源与目标坐标系 */
  annotate?: boolean;
}

/* ------------------- 分带编码预检（防止带号前缀选错） ------------------- */

interface TmercDef {
  code: string;
  lon0: string;
  x0: number;
}

/** 解析内置的高斯-克吕格定义参数（UTM 用 +zone，不在此列） */
function tmercDefs(): TmercDef[] {
  const out: TmercDef[] = [];
  for (const p of PROJECTIONS) {
    if (!p.proj4.includes('+proj=tmerc')) continue;
    const lon0 = /\+lon_0=(-?[\d.]+)/.exec(p.proj4)?.[1];
    const x0 = /\+x_0=(-?[\d.]+)/.exec(p.proj4)?.[1];
    if (lon0 === undefined || x0 === undefined) continue;
    out.push({ code: p.code, lon0, x0: Number(x0) });
  }
  return out;
}

/** 取要素集合东坐标的中位数，判断数据实际落在哪一套编码下 */
function medianEasting(fc: FeatureCollection, limit = 400): number | null {
  const xs: number[] = [];
  for (const f of fc.features as Feature[]) {
    walkPositions(f.geometry, (pos) => {
      if (xs.length < limit && Number.isFinite(pos[0])) xs.push(pos[0]);
    });
    if (xs.length >= limit) break;
  }
  if (xs.length === 0) return null;
  xs.sort((a, b) => a - b);
  return xs[Math.floor(xs.length / 2)];
}

/**
 * 高斯-克吕格分带编码预检。
 *
 * 「带带号」与「无带号」两套编码中央经线相同、假东坐标相差 `带号 × 1e6` 米，
 * 选错必然算错。这里比较数据东坐标量级与该编码的假东坐标，明显不符时
 * 找出**同中央经线的另一种编码**并给出明确建议。
 * 返回建议文案；数据看起来匹配或无法判断时返回 null。
 */
export function suggestGaussKrugerVariant(fc: FeatureCollection, code: string): string | null {
  const defs = tmercDefs();
  const current = defs.find((d) => d.code === code);
  if (!current) return null;

  const median = medianEasting(fc);
  if (median === null) return null;

  const off = Math.abs(median - current.x0);
  if (off < 1_000_000) return null; // 量级相符，无需干预

  const alternative = defs
    .filter((d) => d.lon0 === current.lon0 && d.code !== current.code)
    .map((d) => ({ def: d, delta: Math.abs(median - d.x0) }))
    .filter((c) => c.delta < 200_000)
    .sort((a, b) => a.delta - b.delta)[0];

  const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');
  const base =
    `数据东坐标约 ${fmt(median)}，而 ${code} 的假东坐标是 ${fmt(current.x0)}` +
    `（相差约 ${fmt(off)} 米），量级不符 —— 源坐标系多半选错了。`;
  if (!alternative) {
    return base + '请确认数据的投影类型与分带编码。';
  }
  return (
    base +
    `数据看起来${median >= current.x0 ? '带' : '不带'}带号前缀，` +
    `同一中央经线（${current.lon0}E）应使用 ${alternative.def.code}。请把源投影改为 ${alternative.def.code}。`
  );
}

/** Web 墨卡托的有效坐标范围（米，约 ±20037509） */
const WEBMERC_LIMIT = 20037509;

function isWebMercatorCode(code: string): boolean {
  return code === 'EPSG:3857' || code === MERC_CODE_GCJ || code === MERC_CODE_BD09;
}

/**
 * 转换结果合理性校验 —— 用来兜住「源坐标系选错」这类错误。
 *
 * 最容易踩的坑：CGCS2000 分带投影有「带带号」与「无带号」两套 EPSG 编码，
 * 中央经线相同但东坐标相差 `带号 × 1,000,000` 米（38 带即 3800 万米）。
 * 选错后转换结果会明显越界，与其产出一个位置荒谬的文件，不如直接报错说明原因。
 */
export function assertPlausibleReproject(fc: FeatureCollection, toCode: string): void {
  const kind = projectionKind(toCode);

  if (kind === 'geographic') {
    const check = checkLngLatRange(fc);
    if (check.ok) return;
    throw new Error(
      `${rangeErrorHint(check)}，说明**源坐标系选错了**。` +
        '若源数据是 CGCS2000 分带投影，请注意两套编码：' +
        '「带带号」的东坐标带带号前缀（如 38 带 EPSG:4526，东坐标约 38,500,000 起），' +
        '「无带号」的东坐标约 500,000 起（如 EPSG:4547）—— 请按数据实际的东坐标位数选择。'
    );
  }

  if (isWebMercatorCode(toCode)) {
    let offender: number[] | null = null;
    for (const f of fc.features as Feature[]) {
      walkPositions(f.geometry, (pos) => {
        if (offender) return;
        const [x, y] = pos;
        if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > WEBMERC_LIMIT || Math.abs(y) > WEBMERC_LIMIT) {
          offender = pos;
        }
      });
      if (offender) break;
    }
    if (offender) {
      throw new Error(
        `转换结果 [${offender[0]}, ${offender[1]}] 超出 Web 墨卡托有效范围（±${WEBMERC_LIMIT} m），` +
          '说明源坐标系选错了。请检查源数据的分带编码（是否含带号前缀）与投影类型。'
      );
    }
  }
}

/** 对 FeatureCollection 做整体投影转换 */
export function reprojectFeatureCollection(
  fc: FeatureCollection,
  fromCode: string,
  toCode: string,
  options: ReprojectOptions = {}
): FeatureCollection {
  const next: FeatureCollection = structuredClone(fc);
  try {
    for (const f of next.features as Feature[]) {
      walkPositions(f.geometry, (pos) => {
        if (pos.length < 2) return;
        const [x, y] = reprojectCoord([pos[0], pos[1]], fromCode, toCode);
        pos[0] = x;
        pos[1] = y;
      });
      if (options.annotate && f.properties && typeof f.properties === 'object') {
        (f.properties as Record<string, unknown>)['*sourceCRS'] = fromCode;
        (f.properties as Record<string, unknown>)['*targetCRS'] = toCode;
      }
    }
  } catch (e) {
    // 源坐标系与实际数据不匹配时（最常见：分带带号前缀搞错），换算在数学上无解，
    // proj4 会抛出难以理解的内部错误 —— 这里换成能指明原因的提示。
    throw new Error(
      `投影换算失败（${fromCode} → ${toCode}）：${(e as Error).message}。` +
        '通常说明源坐标系与实际数据不匹配 —— 请检查投影类型，以及分带编码是否含带号前缀。'
    );
  }
  return next;
}

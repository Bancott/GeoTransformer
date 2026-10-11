import type { FeatureCollection, Feature, Geometry, Position } from 'geojson';

/**
 * 坐标形态与范围工具（纯函数，无 DOM）。
 *
 * 两件事：
 * 1. **范围校验** —— KML / GPX / OSM XML 三种格式按规范只允许经纬度（度）。
 *    一旦把投影坐标（如 EPSG:3857 的米制坐标 12956609, 4852509）写进去，
 *    得到的文件在任何软件里都无法使用 —— 与其静默产出坏文件，不如提前拦下来。
 * 2. **降维（丢弃 Z）** —— 带高程的坐标会让 QGIS 把数据判定为三维（EPSG:4979），
 *    在切换项目坐标系时可能无法正确换算；需要二维输出时把第三个分量去掉。
 */

/** 经纬度的合法取值范围（略放宽，避免边界数据被误杀） */
const LNG_MAX = 180;
const LAT_MAX = 90;

export interface RangeCheckResult {
  ok: boolean;
  /** 第一个越界坐标，便于给出可定位的报错 */
  offender?: Position;
  /** 实际参与检查的坐标数量 */
  checked: number;
}

function isDegreePair(pos: Position): boolean {
  const [x, y] = pos;
  return (
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    Math.abs(x) <= LNG_MAX &&
    Math.abs(y) <= LAT_MAX
  );
}

function walk(geom: unknown, cb: (pos: Position) => boolean): boolean {
  if (!geom || typeof geom !== 'object') return true;
  const g = geom as { type?: string; coordinates?: unknown; geometries?: unknown[] };
  if (Array.isArray(g.coordinates)) {
    const visit = (arr: unknown[]): boolean => {
      if (arr.length === 0) return true;
      const [a, b] = arr as [unknown, unknown];
      if (typeof a === 'number' && typeof b === 'number') return cb(arr as Position);
      for (const item of arr) {
        if (Array.isArray(item) && !visit(item)) return false;
      }
      return true;
    };
    return visit(g.coordinates as unknown[]);
  }
  if (g.type === 'GeometryCollection' && Array.isArray(g.geometries)) {
    return g.geometries.every((sub) => walk(sub, cb));
  }
  return true;
}

/**
 * 检查要素集合中的坐标是否都落在经纬度范围内。
 * 空集合视为 ok（没有可校验的坐标）。
 */
export function checkLngLatRange(fc: FeatureCollection): RangeCheckResult {
  let checked = 0;
  let offender: Position | undefined;

  for (const f of fc.features ?? []) {
    const ok = walk(f?.geometry, (pos) => {
      checked++;
      if (isDegreePair(pos)) return true;
      offender = pos;
      return false;
    });
    if (!ok) break;
  }

  return { ok: offender === undefined, offender, checked };
}

/** 要素集合是否全部为经纬度坐标（度） */
export function isLngLatDegrees(fc: FeatureCollection): boolean {
  return checkLngLatRange(fc).ok;
}

/** 组装给用户看的越界提示 */
export function rangeErrorHint(result: RangeCheckResult): string {
  const off = result.offender;
  return off
    ? `检测到坐标 [${off[0]}, ${off[1]}] 超出经纬度范围`
    : '检测到坐标超出经纬度范围';
}

/* ------------------------------ 降维：丢弃 Z ------------------------------ */

function dropZInGeometry(geom: Geometry): Geometry {
  const strip = (pos: unknown): unknown => {
    if (!Array.isArray(pos)) return pos;
    const [a, b] = pos as [unknown, unknown];
    if (typeof a === 'number' && typeof b === 'number') return [a, b];
    return pos.map(strip);
  };
  if (geom.type === 'GeometryCollection') {
    return { ...geom, geometries: geom.geometries.map(dropZInGeometry) };
  }
  const g = geom as { coordinates?: unknown };
  if (g.coordinates === undefined) return geom;
  return { ...geom, coordinates: strip(g.coordinates) } as Geometry;
}

/**
 * 返回全部坐标都只有经纬度（二维）的副本。
 * 已为二维或没有几何的要素保持原样。
 */
export function dropZ(fc: FeatureCollection): FeatureCollection {
  return {
    ...fc,
    features: (fc.features ?? []).map((f) =>
      f?.geometry ? ({ ...f, geometry: dropZInGeometry(f.geometry) } as Feature) : f
    ),
  };
}

/** 判断要素集合里是否存在三维坐标 */
export function hasZ(fc: FeatureCollection): boolean {
  let found = false;
  for (const f of fc.features ?? []) {
    if (!f?.geometry) continue;
    const geom = f.geometry;
    const check = (pos: unknown): void => {
      if (found || !Array.isArray(pos)) return;
      const [a, b] = pos as [unknown, unknown];
      if (typeof a === 'number' && typeof b === 'number') {
        if (pos.length > 2 && Number.isFinite(Number(pos[2]))) found = true;
        return;
      }
      pos.forEach(check);
    };
    if (geom.type === 'GeometryCollection') geom.geometries.forEach((g) => check((g as { coordinates?: unknown }).coordinates));
    else check((geom as { coordinates?: unknown }).coordinates);
  }
  return found;
}

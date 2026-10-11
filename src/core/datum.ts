import type { Position, FeatureCollection } from 'geojson';
import { wgs84ToGcj02, gcj02ToWgs84, wgs84ToBd09, bd09ToWgs84 } from '@/core/coordTransform';

/**
 * 地理坐标系（包含基准）互转：WGS84 / GCJ-02 / BD-09 / CGCS2000 / PZ-90 / GRS-80。
 * - GCJ-02、BD-09：中国大陆的偏移算法（见 coordTransform.ts）。
 * - CGCS2000、GRS-80：与 WGS84 椭球几乎一致（亚米级），工程上按恒等处理。
 * - PZ-90（俄罗斯 GLONASS）：采用常用 7 参数 Helmert 变换近似（精度数米量级）。
 */

export type GeographicSystem = 'WGS84' | 'GCJ02' | 'BD09' | 'CGCS2000' | 'PZ90' | 'GRS80';

export const GEOGRAPHIC_SYSTEMS: { id: GeographicSystem; name: string; full: string }[] = [
  { id: 'WGS84', name: 'WGS84', full: '国际标准 / GPS / OSM / 谷歌(国外)' },
  { id: 'GCJ02', name: 'GCJ-02', full: '火星坐标 / 高德、腾讯、天地图' },
  { id: 'BD09', name: 'BD-09', full: '百度坐标 / 百度地图' },
  { id: 'CGCS2000', name: 'CGCS2000', full: '国家2000 / 中国大地坐标系' },
  { id: 'PZ90', name: 'PZ-90', full: '俄罗斯 / GLONASS 坐标系' },
  { id: 'GRS80', name: 'GRS-80', full: '国际大地测量参考椭球' },
];

interface HelmertParams {
  tx: number;
  ty: number;
  tz: number;
  /** 旋转（弧秒） */
  rx: number;
  ry: number;
  rz: number;
  /** 尺度（ppm） */
  s: number;
}

/** 各基准相对 WGS84 的 7 参数（PZ-90 为常用近似值；CGCS2000 / GRS-80 按恒等） */
const HELMERT_TO_WGS84: Record<GeographicSystem, HelmertParams | null> = {
  WGS84: null,
  GCJ02: null,
  BD09: null,
  CGCS2000: null, // 亚米级差异，近似恒等
  GRS80: null, // 与前两者亚米级差异，近似恒等
  PZ90: { tx: 1.36, ty: -0.29, tz: -3.18, rx: 0, ry: 0, rz: -0.108, s: 0 }, // PZ-90 -> WGS84
};

const WGS84_A = 6378137.0;
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = WGS84_F * (2 - WGS84_F);
const DEG = Math.PI / 180;
const ARCSEC = DEG / 3600;
const PPM = 1e-6;

interface Ecef {
  x: number;
  y: number;
  z: number;
}

function geodeticToEcef(lng: number, lat: number, h: number): Ecef {
  const lam = lng * DEG;
  const phi = lat * DEG;
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinPhi * sinPhi);
  return {
    x: (n + h) * cosPhi * Math.cos(lam),
    y: (n + h) * cosPhi * Math.sin(lam),
    z: (n * (1 - WGS84_E2) + h) * sinPhi,
  };
}

function ecefToGeodetic(p: Ecef): [number, number] {
  const lon = Math.atan2(p.y, p.x);
  const pxy = Math.sqrt(p.x * p.x + p.y * p.y);
  let lat = Math.atan2(p.z, pxy * (1 - WGS84_E2));
  for (let i = 0; i < 6; i++) {
    const sinLat = Math.sin(lat);
    const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
    const h = pxy / Math.cos(lat) - n;
    lat = Math.atan2(p.z, pxy * (1 - WGS84_E2 * (n / (n + h))));
  }
  return [lon / DEG, lat / DEG];
}

/** 位置向量约定（EPSG）7 参数 Helmert 正变换：target = source + t + (1+s)·R·source */
function helmertForward(p: Ecef, prm: HelmertParams): Ecef {
  const rx = prm.rx * ARCSEC;
  const ry = prm.ry * ARCSEC;
  const rz = prm.rz * ARCSEC;
  const k = 1 + prm.s * PPM;
  return {
    x: prm.tx + k * (p.x - rz * p.y + ry * p.z),
    y: prm.ty + k * (rz * p.x + p.y - rx * p.z),
    z: prm.tz + k * (-ry * p.x + rx * p.y + p.z),
  };
}

/** 逆变换：对小幅参数近似，负号取反 */
function helmertInverse(p: Ecef, prm: HelmertParams): Ecef {
  const inv: HelmertParams = {
    tx: -prm.tx,
    ty: -prm.ty,
    tz: -prm.tz,
    rx: -prm.rx,
    ry: -prm.ry,
    rz: -prm.rz,
    s: -prm.s,
  };
  return helmertForward(p, inv);
}

/** 把坐标从某个来源基准转到 WGS84（地理坐标，[lng,lat]） */
export function anyToWgs84(from: GeographicSystem, coord: [number, number]): [number, number] {
  const [lng, lat] = coord;
  switch (from) {
    case 'WGS84':
    case 'CGCS2000':
    case 'GRS80':
      return [lng, lat];
    case 'GCJ02':
      return gcj02ToWgs84(lng, lat);
    case 'BD09':
      return bd09ToWgs84(lng, lat);
    case 'PZ90': {
      const prm = HELMERT_TO_WGS84.PZ90;
      if (!prm) return [lng, lat];
      const ecef = helmertForward(geodeticToEcef(lng, lat, 0), prm);
      return ecefToGeodetic(ecef);
    }
    default:
      return [lng, lat];
  }
}

/** 把 WGS84 坐标转到目标基准（地理坐标，[lng,lat]） */
export function wgs84ToAny(to: GeographicSystem, coord: [number, number]): [number, number] {
  const [lng, lat] = coord;
  switch (to) {
    case 'WGS84':
    case 'CGCS2000':
    case 'GRS80':
      return [lng, lat];
    case 'GCJ02':
      return wgs84ToGcj02(lng, lat);
    case 'BD09':
      return wgs84ToBd09(lng, lat);
    case 'PZ90': {
      const prm = HELMERT_TO_WGS84.PZ90;
      if (!prm) return [lng, lat];
      const ecef = helmertInverse(geodeticToEcef(lng, lat, 0), prm);
      return ecefToGeodetic(ecef);
    }
    default:
      return [lng, lat];
  }
}

/** 通用：任意两个地理坐标系（含基准）互转 */
export function convertGeographicCoord(
  from: GeographicSystem,
  to: GeographicSystem,
  coord: Position
): Position {
  if (from === to) return [coord[0], coord[1]];
  const wgs = anyToWgs84(from, [coord[0], coord[1]]);
  return wgs84ToAny(to, wgs);
}

function walkArray(arr: unknown[], cb: (pos: Position) => void): void {
  if (arr.length === 0) return;
  if (typeof arr[0] === 'number' && typeof arr[1] === 'number') {
    cb(arr as unknown as Position);
    return;
  }
  for (const item of arr) if (Array.isArray(item)) walkArray(item, cb);
}

function walkGeom(geom: unknown, cb: (pos: Position) => void): void {
  if (!geom || typeof geom !== 'object') return;
  const g = geom as { type?: string; coordinates?: unknown; geometries?: unknown[] };
  if (Array.isArray(g.coordinates)) walkArray(g.coordinates, cb);
  else if (g.type === 'GeometryCollection' && Array.isArray(g.geometries)) {
    g.geometries.forEach((sub) => walkGeom(sub, cb));
  }
}

/** 对 GeoJSON 整体做地理坐标系（含基准）转换 */
export function convertGeographicFeatureCollection(
  fc: FeatureCollection,
  from: GeographicSystem,
  to: GeographicSystem
): FeatureCollection {
  if (from === to) return fc;
  const next: FeatureCollection = structuredClone(fc);
  for (const f of next.features) {
    walkGeom(f.geometry, (pos) => {
      const [x, y] = convertGeographicCoord(from, to, pos);
      pos[0] = x;
      pos[1] = y;
    });
  }
  return next;
}

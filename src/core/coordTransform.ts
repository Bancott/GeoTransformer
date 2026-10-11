import type { Position, FeatureCollection } from 'geojson';
import type { CoordSystem } from '@/core/types';

/**
 * 国内坐标系互转（WGS-84 / GCJ-02 / BD-09）。
 * 算法为公开的国内互联网地图常用转换，纯函数实现，无副作用。
 */

const PI = Math.PI;
const X_PI = (PI * 3000) / 180;
const A = 6378245.0; // 长半轴
const EE = 0.00669342162296594323; // 偏心率平方

/** 中国大陆范围粗略判断（GCJ/BD 偏移仅适用于国内） */
export function outOfChina(lng: number, lat: number): boolean {
  return !(lng > 73.66 && lng < 135.05 && lat > 3.86 && lat < 53.55);
}

function transformLat(x: number, y: number): number {
  let ret =
    -100.0 +
    2.0 * x +
    3.0 * y +
    0.2 * y * y +
    0.1 * x * y +
    0.2 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(y * PI) + 40.0 * Math.sin((y / 3.0) * PI)) * 2.0) / 3.0;
  ret += ((160.0 * Math.sin((y / 12.0) * PI) + 320 * Math.sin((y * PI) / 30.0)) * 2.0) / 3.0;
  return ret;
}

function transformLng(x: number, y: number): number {
  let ret =
    300.0 +
    x +
    2.0 * y +
    0.1 * x * x +
    0.1 * x * y +
    0.1 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(x * PI) + 40.0 * Math.sin((x / 3.0) * PI)) * 2.0) / 3.0;
  ret += ((150.0 * Math.sin((x / 12.0) * PI) + 300.0 * Math.sin((x / 30.0) * PI)) * 2.0) / 3.0;
  return ret;
}

/** WGS-84 到 GCJ-02 的偏移量 [dLng, dLat] */
export function offsetWgs84ToGcj02(lng: number, lat: number): [number, number] {
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((A * (1 - EE)) / (magic * sqrtMagic)) * PI);
  dLng = (dLng * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * PI);
  return [dLng, dLat];
}

/** WGS-84 -> GCJ-02 */
export function wgs84ToGcj02(lng: number, lat: number): [number, number] {
  if (outOfChina(lng, lat)) return [lng, lat];
  const [dlng, dlat] = offsetWgs84ToGcj02(lng, lat);
  return [lng + dlng, lat + dlat];
}

/** GCJ-02 -> WGS-84（迭代法求逆精度更高） */
export function gcj02ToWgs84(lng: number, lat: number): [number, number] {
  if (outOfChina(lng, lat)) return [lng, lat];
  let wgsLng = lng;
  let wgsLat = lat;
  for (let i = 0; i < 8; i++) {
    const [dLng, dLat] = offsetWgs84ToGcj02(wgsLng, wgsLat);
    wgsLng = lng - dLng;
    wgsLat = lat - dLat;
  }
  return [wgsLng, wgsLat];
}

/** GCJ-02 -> BD-09 */
export function gcj02ToBd09(lng: number, lat: number): [number, number] {
  const x = lng;
  const y = lat;
  const z = Math.sqrt(x * x + y * y) + 0.00002 * Math.sin(y * X_PI);
  const theta = Math.atan2(y, x) + 0.000003 * Math.cos(x * X_PI);
  const bdLng = z * Math.cos(theta) + 0.0065;
  const bdLat = z * Math.sin(theta) + 0.006;
  return [bdLng, bdLat];
}

/** BD-09 -> GCJ-02 */
export function bd09ToGcj02(lng: number, lat: number): [number, number] {
  const x = lng - 0.0065;
  const y = lat - 0.006;
  const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * X_PI);
  const theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * X_PI);
  const gcjLng = z * Math.cos(theta);
  const gcjLat = z * Math.sin(theta);
  return [gcjLng, gcjLat];
}

export function wgs84ToBd09(lng: number, lat: number): [number, number] {
  const [gLng, gLat] = wgs84ToGcj02(lng, lat);
  return gcj02ToBd09(gLng, gLat);
}

export function bd09ToWgs84(lng: number, lat: number): [number, number] {
  const [gLng, gLat] = bd09ToGcj02(lng, lat);
  return gcj02ToWgs84(gLng, gLat);
}

/** 通用切换：将 [lng, lat] 从 from 系转换到 to 系 */
export function convertCoord(
  from: CoordSystem,
  to: CoordSystem,
  coord: Position
): Position {
  let [lng, lat] = coord as [number, number];
  if (from === to) return [lng, lat];
  // 统一先转 WGS84，再转到目标系
  switch (from) {
    case 'GCJ02':
      [lng, lat] = gcj02ToWgs84(lng, lat);
      break;
    case 'BD09':
      [lng, lat] = bd09ToWgs84(lng, lat);
      break;
  }
  switch (to) {
    case 'GCJ02':
      [lng, lat] = wgs84ToGcj02(lng, lat);
      break;
    case 'BD09':
      [lng, lat] = wgs84ToBd09(lng, lat);
      break;
  }
  return [lng, lat];
}

/** 把 GeoJSON 里所有坐标做坐标系转换（仅 X/Y，忽略 Z） */
export function convertFeatureCollection(
  fc: FeatureCollection,
  from: CoordSystem,
  to: CoordSystem
): FeatureCollection {
  if (from === to) return fc;
  const next: FeatureCollection = structuredClone(fc);
  for (const f of next.features) {
    walkCoordinates(f.geometry, (pos) => {
      const [lng, lat] = convertCoord(from, to, pos);
      pos[0] = lng;
      pos[1] = lat;
    });
  }
  return next;
}

/** 递归遍历并原地修改所有坐标 */
function walkCoordinates(
  geom: unknown,
  cb: (pos: Position) => void
): void {
  if (!geom || typeof geom !== 'object') return;
  const g = geom as { type?: string; coordinates?: unknown };
  if (Array.isArray(g.coordinates)) {
    walkArray(g.coordinates, cb);
  } else if (g.type === 'GeometryCollection') {
    const gc = g as { geometries: unknown[] };
    for (const sub of gc.geometries) walkCoordinates(sub, cb);
  }
}

function walkArray(arr: unknown[], cb: (pos: Position) => void): void {
  if (arr.length === 0) return;
  // 判断是否为坐标对
  if (
    typeof arr[0] === 'number' &&
    typeof arr[1] === 'number'
  ) {
    cb(arr as unknown as Position);
    return;
  }
  for (const item of arr) {
    if (Array.isArray(item)) walkArray(item, cb);
  }
}

import type { FeatureCollection, Feature, Geometry } from 'geojson';

/** 把 JSON 字符串解析为 FeatureCollection（自动把 Feature / Geometry 包一层） */
export function parseGeoJSONString(text: string): FeatureCollection {
  const data = JSON.parse(text) as
    | FeatureCollection
    | Feature
    | Geometry
    | { type: string; coordinates?: unknown; geometries?: unknown };

  if (!data || typeof data !== 'object' || !('type' in data)) {
    throw new Error('不是有效的 GeoJSON 对象');
  }

  if (data.type === 'FeatureCollection') {
    return data as FeatureCollection;
  }
  if (data.type === 'Feature') {
    return {
      type: 'FeatureCollection',
      features: [data as unknown as Feature],
    } as FeatureCollection;
  }
  if (typeof data.type === 'string' && ('coordinates' in data || 'geometries' in data)) {
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: data as unknown as Geometry,
        } as Feature,
      ],
    } as FeatureCollection;
  }
  throw new Error('不支持的 GeoJSON 类型：' + data.type);
}

/** 计算包围盒 [west, south, east, north] */
export function getBounds(fc: FeatureCollection): [number, number, number, number] {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  const walk = (pos: number[]): void => {
    if (pos.length < 2) return;
    if (pos[0] < west) west = pos[0];
    if (pos[0] > east) east = pos[0];
    if (pos[1] < south) south = pos[1];
    if (pos[1] > north) north = pos[1];
  };
  const walkArray = (arr: unknown[]): void => {
    if (arr.length === 0) return;
    if (typeof arr[0] === 'number' && typeof arr[1] === 'number') {
      walk(arr as number[]);
      return;
    }
    for (const item of arr) if (Array.isArray(item)) walkArray(item);
  };
  const walkGeom = (geom: unknown): void => {
    if (!geom || typeof geom !== 'object') return;
    const g = geom as { type?: string; coordinates?: unknown; geometries?: unknown[] };
    if (Array.isArray(g.coordinates)) walkArray(g.coordinates);
    else if (g.type === 'GeometryCollection' && Array.isArray(g.geometries)) {
      g.geometries.forEach(walkGeom);
    }
  };
  for (const f of fc.features) walkGeom((f as unknown as { geometry?: unknown }).geometry);
  if (!Number.isFinite(west)) return [0, 0, 0, 0];
  return [west, south, east, north];
}

/** 统计要素数量与几何类型 */
export function stats(fc: FeatureCollection) {
  const count = fc.features.length;
  const types = new Set<string>();
  const coordCount = { count: 0 };
  const countGeom = (geom: unknown): void => {
    if (!geom || typeof geom !== 'object') return;
    const g = geom as { type?: string; coordinates?: unknown; geometries?: unknown[] };
    if (g.type) types.add(g.type);
    if (Array.isArray(g.coordinates)) {
      let n = 0;
      const c = (a: unknown[]): void => {
        if (a.length && typeof a[0] === 'number' && typeof a[1] === 'number') {
          n++;
          return;
        }
        a.forEach((x) => Array.isArray(x) && c(x));
      };
      c(g.coordinates);
      coordCount.count += n;
    } else if (g.type === 'GeometryCollection' && Array.isArray(g.geometries)) {
      g.geometries.forEach(countGeom);
    }
  };
  fc.features.forEach((f) => countGeom((f as unknown as { geometry?: unknown }).geometry));
  return { count, types: Array.from(types), coordCount: coordCount.count };
}

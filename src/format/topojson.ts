import { topology } from 'topojson-server';
import { feature } from 'topojson-client';
import type { FeatureCollection } from 'geojson';
import type { Topology, GeometryCollection } from 'topojson-specification';

export interface TopoJSONOptions {
  /** 量化位数，用于压缩数据（可选） */
  quantization?: number;
  /** 对象命名空间名 */
  objectName?: string;
}

/** GeoJSON -> TopoJSON 对象 */
export function geoJSONToTopoJSON(
  fc: FeatureCollection,
  options: TopoJSONOptions = {}
): Topology {
  const objectName = options.objectName ?? 'data';
  return topology({ [objectName]: fc as never }, options.quantization) as Topology;
}

/** GeoJSON -> TopoJSON 字符串 */
export function geoJSONToTopoJSONString(
  fc: FeatureCollection,
  options: TopoJSONOptions = {}
): string {
  return JSON.stringify(geoJSONToTopoJSON(fc, options));
}

/** TopoJSON -> GeoJSON */
export function topoJSONToGeoJSON(topo: Topology): FeatureCollection {
  const objects = topo.objects as Record<string, GeometryCollection>;
  const keys = Object.keys(objects);
  if (keys.length === 0) throw new Error('TopoJSON 中没有对象');
  const obj = objects[keys[0]];
  const result = feature(topo, obj) as unknown as {
    type: string;
    features?: unknown[];
  };
  if (result.type === 'Feature' && !result.features) {
    return { type: 'FeatureCollection', features: [result] } as unknown as FeatureCollection;
  }
  return result as unknown as FeatureCollection;
}

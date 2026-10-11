import type { Geometry, Position, FeatureCollection, Feature } from 'geojson';

/**
 * DXF（AutoCAD 交换格式，ASCII）↔ GeoJSON（常见实体子集）。
 * 读取支持：POINT / LINE / LWPOLYLINE / POLYLINE / CIRCLE / TEXT / MTEXT。
 * 写出支持：Point -> POINT，LineString -> LWPOLYLINE，Polygon -> 闭合 LWPOLYLINE。
 * 单位默认为米，坐标为项目坐标（通常为投影坐标系，按用户语义处理）。
 */

/* ------------------------------ 读取 ------------------------------ */

type Pairs = Array<[number, string]>;

function toPairs(text: string): Pairs {
  const lines = text.split(/\r?\n/);
  const pairs: Pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i].trim());
    if (Number.isNaN(code)) continue;
    pairs.push([code, lines[i + 1].trim()]);
  }
  return pairs;
}

interface Entity {
  type: string;
  groups: Pairs;
}

function extractEntities(pairs: Pairs): Entity[] {
  const entities: Entity[] = [];
  let current: Entity | null = null;
  let inEntities = false;
  let inVertex = false;

  const finalize = (): void => {
    if (current) {
      entities.push(current);
      current = null;
    }
  };

  for (const [code, value] of pairs) {
    if (code === 0) {
      const v = value;
      if (v === 'ENTITIES') {
        inEntities = true;
        continue;
      }
      if (v === 'ENDSEC') {
        finalize();
        inEntities = false;
        continue;
      }
      if (v === 'EOF') {
        finalize();
        break;
      }
      if (!inEntities) continue;
      if (v === 'VERTEX') {
        // 旧式 POLYLINE 的顶点：并入当前实体作为额外的 10/20 坐标
        inVertex = true;
        current ??= { type: 'POLYLINE', groups: [] };
        continue;
      }
      if (v === 'SEQEND') {
        inVertex = false;
        continue;
      }
      // 其它实体的开始
      finalize();
      current = { type: v, groups: [] };
      inVertex = false;
      continue;
    }
    if (!inEntities || !current) continue;
    if (inVertex) {
      // 仅收集顶点坐标。
      if (code === 10) current.groups.push([10, value]);
      else if (code === 20) current.groups.push([20, value]);
      continue;
    }
    current.groups.push([code, value]);
  }
  finalize();
  return entities;
}

function get(groups: Pairs, code: number): string | undefined {
  const pair = groups.find(([c]) => c === code);
  return pair?.[1];
}
function getAll(groups: Pairs, code: number): string[] {
  return groups.filter(([c]) => c === code).map(([, v]) => v);
}

/** 从 LWPOLYLINE / POLYLINE 的顶点组构造坐标列表 */
function verticesFromPoly(groups: Pairs): { coords: Position[]; closed: boolean } {
  const closedFlag = Number(get(groups, 70) ?? '0');
  const closed = (closedFlag & 1) === 1;
  const xs = getAll(groups, 10).map(Number);
  const ys = getAll(groups, 20).map(Number);
  const coords: Position[] = [];
  const n = Math.min(xs.length, ys.length);
  for (let i = 0; i < n; i++) {
    if (!Number.isNaN(xs[i]) && !Number.isNaN(ys[i])) coords.push([xs[i], ys[i]]);
  }
  // 对于 POLYLINE（构造型），顶点可能通过 VERTEX 组提供，而非 10/20；
  // 这里再尝试从整个实体（含后续组）读取 VERTEX 段的坐标——已在 extract 中合并。
  return { coords, closed };
}

function geometryFromEntity(e: Entity): Geometry | null {
  const t = e.type.toUpperCase();
  switch (t) {
    case 'POINT': {
      const x = Number(get(e.groups, 10));
      const y = Number(get(e.groups, 20));
      if (Number.isNaN(x) || Number.isNaN(y)) return null;
      return { type: 'Point', coordinates: [x, y] };
    }
    case 'LINE': {
      const x1 = Number(get(e.groups, 10));
      const y1 = Number(get(e.groups, 20));
      const x2 = Number(get(e.groups, 11));
      const y2 = Number(get(e.groups, 21));
      if ([x1, y1, x2, y2].some(Number.isNaN)) return null;
      return { type: 'LineString', coordinates: [[x1, y1], [x2, y2]] };
    }
    case 'LWPOLYLINE': {
      const { coords, closed } = verticesFromPoly(e.groups);
      if (coords.length < 2) return null;
      if (closed && coords.length >= 3) {
        const ring = coords.slice();
        ring.push([ring[0][0], ring[0][1]]);
        return { type: 'Polygon', coordinates: [ring] };
      }
      return { type: 'LineString', coordinates: coords };
    }
    case 'POLYLINE': {
      const { coords, closed } = verticesFromPoly(e.groups);
      if (coords.length < 2) return null;
      if (closed && coords.length >= 3) {
        const ring = coords.slice();
        ring.push([ring[0][0], ring[0][1]]);
        return { type: 'Polygon', coordinates: [ring] };
      }
      return { type: 'LineString', coordinates: coords };
    }
    case 'CIRCLE': {
      const x = Number(get(e.groups, 10));
      const y = Number(get(e.groups, 20));
      const r = Number(get(e.groups, 40));
      if ([x, y, r].some(Number.isNaN) || r <= 0) return null;
      const coords: Position[] = [];
      const N = 64;
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * 2 * Math.PI;
        coords.push([x + r * Math.cos(a), y + r * Math.sin(a)]);
      }
      return { type: 'Polygon', coordinates: [coords] };
    }
    case 'TEXT':
    case 'MTEXT': {
      const x = Number(get(e.groups, 10));
      const y = Number(get(e.groups, 20));
      if (Number.isNaN(x) || Number.isNaN(y)) return null;
      return { type: 'Point', coordinates: [x, y] };
    }
    default:
      return null;
  }
}

/** DXF 字符串 -> GeoJSON */
export function dxfToGeoJSON(text: string): FeatureCollection {
  const entities = extractEntities(toPairs(text));
  const features: Feature[] = [];
  for (const e of entities) {
    const geom = geometryFromEntity(e);
    if (!geom) continue;
    // 对 TEXT/MTEXT 附加文本属性
    const props: Record<string, unknown> = {};
    if (e.type.toUpperCase() === 'TEXT' || e.type.toUpperCase() === 'MTEXT') props.text = get(e.groups, 1) ?? '';
    features.push({ type: 'Feature', properties: props, geometry: geom });
  }
  if (features.length === 0) throw new Error('DXF 中没有可解析的实体');
  return { type: 'FeatureCollection', features };
}

/* ------------------------------ 写出 ------------------------------ */

function dxfLine(handler: number, value: string | number): string {
  return `${handler}\n${value}\n`;
}

function polylineEntity(coords: Position[], closed: boolean): string {
  let s = dxfLine(0, 'LWPOLYLINE') + dxfLine(8, 'GeoTransformer') + dxfLine(90, coords.length) + dxfLine(70, closed ? 1 : 0);
  for (const [x, y] of coords) s += dxfLine(10, Number(x.toFixed(6))) + dxfLine(20, Number(y.toFixed(6)));
  return s;
}

function geometryEntities(geom: Geometry): string {
  switch (geom.type) {
    case 'Point': {
      const [x, y] = geom.coordinates as Position;
      return dxfLine(0, 'POINT') + dxfLine(8, 'GeoTransformer') + dxfLine(10, Number(x.toFixed(6))) + dxfLine(20, Number(y.toFixed(6)));
    }
    case 'LineString':
      return polylineEntity(geom.coordinates as Position[], false);
    case 'MultiLineString':
      return (geom.coordinates as Position[][]).map((l) => polylineEntity(l, false)).join('');
    case 'Polygon': {
      const ring = ((geom.coordinates as Position[][])[0] ?? []).slice();
      if (ring.length) ring.push([ring[0][0], ring[0][1]]);
      return polylineEntity(ring, true);
    }
    case 'MultiPolygon':
      return (geom.coordinates as Position[][][])
        .map((p) => {
          const ring = (p[0] ?? []).slice();
          if (ring.length) ring.push([ring[0][0], ring[0][1]]);
          return polylineEntity(ring, true);
        })
        .join('');
    default:
      return '';
  }
}

/** GeoJSON -> DXF 字符串 */
export function geoJSONToDXF(fc: FeatureCollection): string {
  let body = '';
  for (const f of fc.features as Feature[]) {
    if (f.geometry) body += geometryEntities(f.geometry);
  }
  const header =
    // HEADER：$INSUNITS=1（米）
    dxfLine(0, 'SECTION') + dxfLine(2, 'HEADER') + dxfLine(9, '$INSUNITS') + dxfLine(70, 1) + dxfLine(0, 'ENDSEC') +
    // TABLES / LAYER
    dxfLine(0, 'SECTION') + dxfLine(2, 'TABLES') + dxfLine(0, 'TABLE') + dxfLine(2, 'LAYER') + dxfLine(70, 1) +
    dxfLine(0, 'LAYER') + dxfLine(2, 'GeoTransformer') + dxfLine(70, 0) + dxfLine(62, 7) + dxfLine(6, 'CONTINUOUS') +
    dxfLine(0, 'ENDTAB') + dxfLine(0, 'ENDSEC') +
    // ENTITIES
    dxfLine(0, 'SECTION') + dxfLine(2, 'ENTITIES');
  const tail = dxfLine(0, 'ENDSEC') + dxfLine(0, 'EOF');
  const entities = body
    .split(/\n(?=0\n)/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join('\n');
  return header + '\n' + entities + '\n' + tail;
}

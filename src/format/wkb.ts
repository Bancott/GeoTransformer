import type { Geometry, Position, FeatureCollection, Feature } from 'geojson';

/**
 * WKB（Well-Known Binary，十六进制）↔ GeoJSON。
 * 支持标准 WKB 的 1~7 类型（Point / LineString / Polygon / 各 Multi / GeometryCollection），
 * 读取时忽略 Z/M 维度（仅取前两位），写出时固定为 WGS-84 2D 小端序。
 */

const TYPE_POINT = 1;
const TYPE_LINESTRING = 2;
const TYPE_POLYGON = 3;
const TYPE_MULTIPOINT = 4;
const TYPE_MULTILINESTRING = 5;
const TYPE_MULTIPOLYGON = 6;
const TYPE_GEOMCOLL = 7;

const HAS_Z = 0x80000000;
const HAS_M = 0x40000000;
const BASE = 0xff;

/* ------------------------------ 读取 ------------------------------ */

class WkbReader {
  private dv: DataView;
  private pos: number;
  private little = true;
  constructor(buf: ArrayBuffer, offset: number) {
    this.dv = new DataView(buf);
    this.pos = offset;
  }
  private byte(): number {
    return this.dv.getUint8(this.pos++);
  }
  private u32(): number {
    const v = this.dv.getUint32(this.pos, this.little);
    this.pos += 4;
    return v;
  }
  private double(): number {
    const v = this.dv.getFloat64(this.pos, this.little);
    this.pos += 8;
    return v;
  }
  /** 读取一个坐标对并跳过额外的 Z/M 维度 */
  private coord(dims: number): Position {
    const x = this.double();
    const y = this.double();
    for (let i = 2; i < dims; i++) this.double();
    return [x, y];
  }

  geometry(): Geometry {
    this.little = this.byte() === 1;
    const type = this.u32();
    return this.readBody(type & BASE, type);
  }

  private readBody(base: number, type: number): Geometry {
    const dims = 2 + (type & HAS_Z ? 1 : 0) + (type & HAS_M ? 1 : 0);
    switch (base) {
      case TYPE_POINT:
        return { type: 'Point', coordinates: this.coord(dims) };
      case TYPE_LINESTRING: {
        const n = this.u32();
        const coords: Position[] = [];
        for (let i = 0; i < n; i++) coords.push(this.coord(dims));
        return { type: 'LineString', coordinates: coords };
      }
      case TYPE_POLYGON: {
        const nr = this.u32();
        const rings: Position[][] = [];
        for (let r = 0; r < nr; r++) {
          const n = this.u32();
          const ring: Position[] = [];
          for (let i = 0; i < n; i++) ring.push(this.coord(dims));
          rings.push(ring);
        }
        return { type: 'Polygon', coordinates: rings };
      }
      case TYPE_MULTIPOINT: {
        const n = this.u32();
        const coords: Position[] = [];
        for (let i = 0; i < n; i++) coords.push(this.readSub() as Position[] as unknown as Position);
        return { type: 'MultiPoint', coordinates: coords };
      }
      case TYPE_MULTILINESTRING: {
        const n = this.u32();
        const lines: Position[][] = [];
        for (let i = 0; i < n; i++) lines.push(this.readSub() as Position[]);
        return { type: 'MultiLineString', coordinates: lines };
      }
      case TYPE_MULTIPOLYGON: {
        const n = this.u32();
        const polys: Position[][][] = [];
        for (let i = 0; i < n; i++) polys.push(this.readSub() as Position[][]);
        return { type: 'MultiPolygon', coordinates: polys };
      }
      case TYPE_GEOMCOLL: {
        const n = this.u32();
        const geoms: Geometry[] = [];
        for (let i = 0; i < n; i++) geoms.push(this.readSub() as Geometry);
        return { type: 'GeometryCollection', geometries: geoms };
      }
      default:
        throw new Error('不支持的 WKB 几何类型：' + base);
    }
  }

  /** 读取一个子几何（含 byte order 与 type 头） */
  private readSub(): unknown {
    const start = this.pos;
    // 递归读取完整子几何后会推进 pos；此处先读取字节序与类型头
    this.little = this.byte() === 1;
    const type = this.u32();
    return this.readBody(type & BASE, type);
    void start;
  }
}

/* ------------------------------ 写出 ------------------------------ */

class WkbWriter {
  private buf: number[] = [];
  private little = true;
  private u8(v: number): void {
    this.buf.push(v);
  }
  private u32(v: number): void {
    if (this.little) {
      this.buf.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff);
    } else {
      this.buf.push((v >> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff);
    }
  }
  private f64(v: number): void {
    const b = new ArrayBuffer(8);
    const dv = new DataView(b);
    dv.setFloat64(0, v, this.little);
    for (let i = 0; i < 8; i++) this.buf.push(dv.getUint8(i));
  }
  private coord(p: Position): void {
    this.f64(p[0]);
    this.f64(p[1]);
  }
  private start(type: number): void {
    this.u8(this.little ? 1 : 0);
    this.u32(type);
  }
  write(geom: Geometry): ArrayBuffer {
    this.buf = [];
    this.writeGeom(geom);
    return new Uint8Array(this.buf).buffer;
  }
  private writeGeom(geom: Geometry): void {
    switch (geom.type) {
      case 'Point':
        this.start(TYPE_POINT);
        this.coord(geom.coordinates as Position);
        break;
      case 'LineString': {
        this.start(TYPE_LINESTRING);
        const pts = geom.coordinates as Position[];
        this.u32(pts.length);
        pts.forEach((p) => this.coord(p));
        break;
      }
      case 'Polygon': {
        this.start(TYPE_POLYGON);
        const rings = geom.coordinates as Position[][];
        this.u32(rings.length);
        rings.forEach((ring) => {
          this.u32(ring.length);
          ring.forEach((p) => this.coord(p));
        });
        break;
      }
      case 'MultiPoint': {
        this.start(TYPE_MULTIPOINT);
        const pts = geom.coordinates as Position[];
        this.u32(pts.length);
        pts.forEach((p) => {
          this.start(TYPE_POINT);
          this.coord(p);
        });
        break;
      }
      case 'MultiLineString': {
        this.start(TYPE_MULTILINESTRING);
        const lines = geom.coordinates as Position[][];
        this.u32(lines.length);
        lines.forEach((line) => {
          this.start(TYPE_LINESTRING);
          this.u32(line.length);
          line.forEach((p) => this.coord(p));
        });
        break;
      }
      case 'MultiPolygon': {
        this.start(TYPE_MULTIPOLYGON);
        const polys = geom.coordinates as Position[][][];
        this.u32(polys.length);
        polys.forEach((poly) => {
          this.start(TYPE_POLYGON);
          this.u32(poly.length);
          poly.forEach((ring) => {
            this.u32(ring.length);
            ring.forEach((p) => this.coord(p));
          });
        });
        break;
      }
      case 'GeometryCollection': {
        this.start(TYPE_GEOMCOLL);
        this.u32(geom.geometries.length);
        geom.geometries.forEach((g) => this.writeGeom(g));
        break;
      }
      default:
        throw new Error('不支持的 GeoJSON 几何类型：' + (geom as { type: string }).type);
    }
  }
}

/* ------------------------------ 对外接口 ------------------------------ */

function toArrayBuffer(input: string | ArrayBuffer | Uint8Array): ArrayBuffer {
  if (input instanceof ArrayBuffer) return input;
  if (ArrayBuffer.isView(input)) {
    const view = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    const copy = new ArrayBuffer(view.byteLength);
    new Uint8Array(copy).set(view);
    return copy;
  }
  // hex 字符串（可含 0x 前缀、空白）
  const text = input.replace(/^0x/i, '').replace(/\s+/g, '');
  if (!/^[0-9a-fA-F]*$/.test(text)) throw new Error('WKB hex 字符串无效');
  const bytes = new Uint8Array(text.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(text.substr(i * 2, 2), 16);
  const out = new ArrayBuffer(bytes.length);
  new Uint8Array(out).set(bytes);
  return out;
}

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0').toUpperCase();
  return s;
}

/** WKB（ArrayBuffer / hex 字符串）-> GeoJSON 几何 */
export function wkbToGeometry(input: string | ArrayBuffer | Uint8Array): Geometry {
  const buf = toArrayBuffer(input);
  return new WkbReader(buf, 0).geometry();
}

/** WKB -> GeoJSON */
export function wkbToGeoJSON(input: string | ArrayBuffer | Uint8Array): FeatureCollection {
  const geometry = wkbToGeometry(input);
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry }] };
}

/** GeoJSON -> WKB（ArrayBuffer） */
export function geoJSONToWKB(fc: FeatureCollection): ArrayBuffer {
  const geoms = fc.features.map((f) => (f as Feature).geometry).filter(Boolean) as Geometry[];
  if (geoms.length === 0) throw new Error('没有几何要素');
  const writer = new WkbWriter();
  if (geoms.length === 1) return writer.write(geoms[0]);
  return writer.write({ type: 'GeometryCollection', geometries: geoms });
}

/** GeoJSON -> WKB 十六进制字符串（数据库常见存储形式） */
export function geoJSONToWKBHex(fc: FeatureCollection): string {
  return toHex(geoJSONToWKB(fc));
}

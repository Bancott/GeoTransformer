import type { Geometry, Position, FeatureCollection, Feature } from 'geojson';

/**
 * WKT（Well-Known Text）↔ GeoJSON。
 * 仅支持 WGS-84 经纬度的 2D 几何，覆盖 POINT / LINESTRING / POLYGON /
 * MULTIPOINT / MULTILINESTRING / MULTIPOLYGON / GEOMETRYCOLLECTION。
 * 坐标顺序与 GeoJSON 一致（经度在前）。
 */

/* ------------------------------ 解析 ------------------------------ */

/** 轻量 tokenizer，忽略括号、逗号之外的空白 */
function tokenize(wkt: string): string[] {
  const tokens: string[] = [];
  const re = /\(|\)|,|[^\s(),]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(wkt)) !== null) tokens.push(m[0]);
  return tokens;
}

class Parser {
  private tokens: string[];
  private i = 0;
  constructor(wkt: string) {
    this.tokens = tokenize(wkt);
  }

  private peek(): string | undefined {
    return this.tokens[this.i];
  }
  private next(): string {
    return this.tokens[this.i++];
  }
  private expect(tok: string): void {
    const t = this.next();
    if (t !== tok) throw new Error(`WKT 解析错误：期望 "${tok}"，得到 "${t}"`);
  }

  /** 读取一个坐标对（可能含 Z/M，仅取前两位作为 2D 结果） */
  private coord(): number[] {
    const x = parseFloat(this.next());
    const y = parseFloat(this.next());
    // 可选 Z/M：吃掉紧跟的 1~2 个数字，不用于结果
    for (let k = 0; k < 2; k++) {
      const p = this.peek();
      if (p !== undefined && p !== ',' && p !== ')' && !Number.isNaN(parseFloat(p))) this.next();
      else break;
    }
    return [x, y];
  }

  /** 返回某种类型对应的「空几何」 */
  private empty(type: string): Geometry {
    switch (type) {
      case 'POINT':
        return { type: 'Point', coordinates: [] as unknown as Position };
      case 'LINESTRING':
        return { type: 'LineString', coordinates: [] };
      case 'POLYGON':
        return { type: 'Polygon', coordinates: [] };
      case 'MULTIPOINT':
        return { type: 'MultiPoint', coordinates: [] };
      case 'MULTILINESTRING':
        return { type: 'MultiLineString', coordinates: [] };
      case 'MULTIPOLYGON':
        return { type: 'MultiPolygon', coordinates: [] };
      case 'GEOMETRYCOLLECTION':
        return { type: 'GeometryCollection', geometries: [] };
      default:
        throw new Error('不支持的 WKT 几何类型：' + type);
    }
  }

  /** 读取坐标列表直到遇到反括号 */
  private coordList(): Position[] {
    const out: Position[] = [];
    while (this.peek() !== ')' && this.peek() !== undefined) {
      out.push(this.coord() as Position);
      if (this.peek() === ',') this.next();
    }
    return out;
  }

  private parenthesizedCoordList(): Position[] {
    this.expect('(');
    const list = this.coordList();
    this.expect(')');
    return list;
  }

  private parenthesizedCoordLists(): Position[][] {
    this.expect('(');
    const out: Position[][] = [];
    while (this.peek() !== ')' && this.peek() !== undefined) {
      out.push(this.parenthesizedCoordList());
      if (this.peek() === ',') this.next();
    }
    this.expect(')');
    return out;
  }

  private parenthesizedCoordLists2(): Position[][][] {
    this.expect('(');
    const out: Position[][][] = [];
    while (this.peek() !== ')' && this.peek() !== undefined) {
      out.push(this.parenthesizedCoordLists());
      if (this.peek() === ',') this.next();
    }
    this.expect(')');
    return out;
  }

  geometry(): Geometry {
    const type = this.next().toUpperCase();
    if (this.peek() === 'EMPTY') {
      this.next();
      return this.empty(type);
    }
    switch (type) {
      case 'POINT':
        return { type: 'Point', coordinates: this.parenthesizedCoordList()[0] };
      case 'LINESTRING':
        return { type: 'LineString', coordinates: this.parenthesizedCoordList() };
      case 'POLYGON':
        return { type: 'Polygon', coordinates: this.parenthesizedCoordLists() };
      case 'MULTIPOINT':
        return { type: 'MultiPoint', coordinates: this.parenthesizedCoordList() };
      case 'MULTILINESTRING':
        return { type: 'MultiLineString', coordinates: this.parenthesizedCoordLists() };
      case 'MULTIPOLYGON':
        return { type: 'MultiPolygon', coordinates: this.parenthesizedCoordLists2() };
      case 'GEOMETRYCOLLECTION': {
        this.expect('(');
        const geometries: Geometry[] = [];
        while (this.peek() !== ')' && this.peek() !== undefined) {
          geometries.push(this.geometry());
          if (this.peek() === ',') this.next();
        }
        this.expect(')');
        return { type: 'GeometryCollection', geometries };
      }
      case 'ENVELOPE': {
        // ENVELOPE (minX, maxX, minY, maxY) -> 4 点外包矩形（多边形）
        this.expect('(');
        const nums = [this.next(), this.next(), this.next(), this.next()].map(parseFloat);
        this.expect(')');
        const [minX, maxX, minY, maxY] = nums;
        return {
          type: 'Polygon',
          coordinates: [
            [
              [minX, minY],
              [maxX, minY],
              [maxX, maxY],
              [minX, maxY],
              [minX, minY],
            ],
          ],
        };
      }
      default:
        throw new Error('不支持的 WKT 几何类型：' + type);
    }
  }
}

/** 把单个 WKT 几何字符串解析为 GeoJSON 几何 */
export function wktToGeometry(wkt: string): Geometry {
  return new Parser(wkt.trim()).geometry();
}

/** WKT 字符串 -> GeoJSON（支持单个或多个几何，每行一个） */
export function wktToGeoJSON(text: string): FeatureCollection {
  const features: Feature[] = [];
  const lines = text.trim().split(/[;\n\r]+/).map((s) => s.trim()).filter(Boolean);
  for (const line of lines) {
    const geometry = wktToGeometry(line);
    features.push({ type: 'Feature', properties: {}, geometry });
  }
  if (features.length === 0) throw new Error('WKT 内容为空');
  return { type: 'FeatureCollection', features };
}

/* ------------------------------ 写出 ------------------------------ */

function fmt(n: number): string {
  return Number.isFinite(n) ? String(Number(n.toFixed(7))) : '0';
}

function coordStr(p: Position): string {
  return `${fmt(p[0])} ${fmt(p[1])}`;
}
function coordListStr(list: Position[]): string {
  return list.map(coordStr).join(', ');
}

export function geometryToWKT(geom: Geometry): string {
  switch (geom.type) {
    case 'Point':
      return `POINT (${coordStr(geom.coordinates as Position)})`;
    case 'LineString':
      return `LINESTRING (${coordListStr(geom.coordinates as Position[])})`;
    case 'Polygon':
      return `POLYGON (${(geom.coordinates as Position[][])
        .map((ring) => `(${coordListStr(ring)})`)
        .join(', ')})`;
    case 'MultiPoint':
      return `MULTIPOINT (${(geom.coordinates as Position[]).map(coordStr).join(', ')})`;
    case 'MultiLineString':
      return `MULTILINESTRING (${(geom.coordinates as Position[][])
        .map((line) => `(${coordListStr(line)})`)
        .join(', ')})`;
    case 'MultiPolygon':
      return `MULTIPOLYGON (${(geom.coordinates as Position[][][])
        .map((poly) => `(${poly.map((ring) => `(${coordListStr(ring)})`).join(', ')})`)
        .join(', ')})`;
    case 'GeometryCollection':
      return `GEOMETRYCOLLECTION (${geom.geometries.map(geometryToWKT).join(', ')})`;
    default:
      throw new Error('不支持的 GeoJSON 几何类型：' + (geom as { type: string }).type);
  }
}

/** GeoJSON -> WKT（单要素输出其几何；多要素输出 GEOMETRYCOLLECTION） */
export function geoJSONToWKT(fc: FeatureCollection): string {
  const geoms = fc.features.map((f) => (f as Feature).geometry).filter(Boolean) as Geometry[];
  if (geoms.length === 0) throw new Error('没有几何要素');
  if (geoms.length === 1) return geometryToWKT(geoms[0]);
  return geometryToWKT({ type: 'GeometryCollection', geometries: geoms });
}

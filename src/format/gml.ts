import type { Geometry, Position, FeatureCollection, Feature, Polygon } from 'geojson';

/**
 * GML（Geography Markup Language，Simple Features Profile）↔ GeoJSON（基础子集）。
 * 读取时按本地名（localName）匹配几何元素，对命名空间尽量包容；
 * 支持 gml:pos / gml:posList / gml:coordinates 三种坐标表示。
 */

/* ------------------------------ 读取 ------------------------------ */

function parsePointsText(text: string): Position[] {
  const t = text.trim();
  if (!t) return [];
  const out: Position[] = [];
  if (t.includes(',')) {
    for (const tok of t.split(/\s+/).filter(Boolean)) {
      const parts = tok.split(',').map(Number);
      if (parts.length >= 2 && !Number.isNaN(parts[0]) && !Number.isNaN(parts[1])) out.push([parts[0], parts[1]]);
    }
    return out;
  }
  const nums = t.split(/\s+/).map(Number);
  for (let i = 0; i + 1 < nums.length; i += 2) {
    if (!Number.isNaN(nums[i]) && !Number.isNaN(nums[i + 1])) out.push([nums[i], nums[i + 1]]);
  }
  return out;
}

function childByLocal(el: Element, name: string): Element | undefined {
  return el.getElementsByTagNameNS('*', name)[0];
}

/** 从包含 pos/posList/coordinates 的容器元素读取坐标 */
function readPointsFromEl(el: Element): Position[] {
  for (const tag of ['posList', 'pos', 'coordinates']) {
    const node = childByLocal(el, tag);
    if (node) return parsePointsText(node.textContent ?? '');
  }
  return [];
}

function polygonRings(el: Element): Position[][] {
  const rings: Position[][] = [];
  const exterior = childByLocal(el, 'exterior');
  if (exterior) rings.push(readPointsFromEl(exterior));
  const interiors = Array.from(el.getElementsByTagNameNS('*', 'interior'));
  for (const inn of interiors) rings.push(readPointsFromEl(inn));
  return rings;
}

function geometryFromElement(el: Element): Geometry | null {
  const name = el.localName.toLowerCase();
  switch (name) {
    case 'point':
      return { type: 'Point', coordinates: readPointsFromEl(el)[0] } as Geometry;
    case 'linestring':
      return { type: 'LineString', coordinates: readPointsFromEl(el) };
    case 'polygon':
      return { type: 'Polygon', coordinates: polygonRings(el) };
    case 'multipoint': {
      const members = Array.from(el.getElementsByTagNameNS('*', 'pointMember'));
      const coords = members.map((m) => readPointsFromEl(m)[0]).filter(Boolean) as Position[];
      if (coords.length === 0 && childByLocal(el, 'pos')) coords.push(readPointsFromEl(el)[0]);
      return { type: 'MultiPoint', coordinates: coords };
    }
    case 'multilinestring': {
      const members = Array.from(el.getElementsByTagNameNS('*', 'lineStringMember'));
      const lines = members.map((m) => readPointsFromEl(m));
      return { type: 'MultiLineString', coordinates: lines };
    }
    case 'multipolygon': {
      const members = Array.from(el.getElementsByTagNameNS('*', 'polygonMember'));
      const polys = members.map((m) => polygonRings(m));
      return { type: 'MultiPolygon', coordinates: polys };
    }
    default:
      return null;
  }
}

/** GML 字符串 -> GeoJSON */
export function gmlToGeoJSON(text: string): FeatureCollection {
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('GML 解析失败');
  const features: Feature[] = [];

  // 优先遍历 featureMember 内的几何；否则直接取命名几何元素
  const members = Array.from(doc.getElementsByTagNameNS('*', 'featureMember'));
  if (members.length) {
    for (const m of members) {
      for (const candidate of Array.from(m.getElementsByTagName('*'))) {
        const geom = geometryFromElement(candidate);
        if (geom) {
          features.push({ type: 'Feature', properties: {}, geometry: geom });
          break;
        }
      }
    }
  } else {
    const geomEls: string[] = ['Point', 'LineString', 'Polygon', 'MultiPoint', 'MultiLineString', 'MultiPolygon'];
    for (const name of geomEls) {
      for (const el of Array.from(doc.getElementsByTagNameNS('*', name))) {
        const geom = geometryFromElement(el);
        const parent = el.parentElement;
        if (geom && (!parent || !parent.localName.toLowerCase().includes('member'))) {
          features.push({ type: 'Feature', properties: {}, geometry: geom });
        }
      }
    }
  }

  if (features.length === 0) throw new Error('GML 中没有可解析的几何');
  return { type: 'FeatureCollection', features };
}

/* ------------------------------ 写出 ------------------------------ */

const GML_NS = 'http://www.opengis.net/gml';

function posStr(p: Position): string {
  return `${p[0].toFixed(7)} ${p[1].toFixed(7)}`;
}
function lineStr(pts: Position[]): string {
  return pts.map(posStr).join(' ');
}

function geometryGml(geom: Geometry): string {
  switch (geom.type) {
    case 'Point':
      return `<gml:Point srsDimension="2"><gml:pos>${posStr(geom.coordinates as Position)}</gml:pos></gml:Point>`;
    case 'LineString':
      return `<gml:LineString srsDimension="2"><gml:posList>${lineStr(geom.coordinates as Position[])}</gml:posList></gml:LineString>`;
    case 'Polygon': {
      const poly = geom as Polygon;
      const rings = poly.coordinates.map((ring, i) => {
        const tag = i === 0 ? 'exterior' : 'interior';
        return `<gml:${tag}><gml:LinearRing><gml:posList>${lineStr(ring)}</gml:posList></gml:LinearRing></gml:${tag}>`;
      });
      return `<gml:Polygon srsDimension="2">${rings.join('')}</gml:Polygon>`;
    }
    case 'MultiPoint':
      return `<gml:MultiPoint srsDimension="2">${(geom.coordinates as Position[])
        .map((p) => `<gml:pointMember><gml:Point><gml:pos>${posStr(p)}</gml:pos></gml:Point></gml:pointMember>`)
        .join('')}</gml:MultiPoint>`;
    case 'MultiLineString':
      return `<gml:MultiLineString srsDimension="2">${(geom.coordinates as Position[][])
        .map((line) => `<gml:lineStringMember><gml:LineString><gml:posList>${lineStr(line)}</gml:posList></gml:LineString></gml:lineStringMember>`)
        .join('')}</gml:MultiLineString>`;
    case 'MultiPolygon':
      return `<gml:MultiPolygon srsDimension="2">${(geom.coordinates as Position[][][])
        .map((poly) => {
          const rings = poly
            .map((ring, i) => {
              const tag = i === 0 ? 'exterior' : 'interior';
              return `<gml:${tag}><gml:LinearRing><gml:posList>${lineStr(ring)}</gml:posList></gml:LinearRing></gml:${tag}>`;
            })
            .join('');
          return `<gml:polygonMember><gml:Polygon>${rings}</gml:Polygon></gml:polygonMember>`;
        })
        .join('')}</gml:MultiPolygon>`;
    case 'GeometryCollection':
      return `<gml:MultiGeometry srsDimension="2">${geom.geometries
        .map((g) => `<gml:geometryMember>${geometryGml(g)}</gml:geometryMember>`)
        .join('')}</gml:MultiGeometry>`;
    default:
      return '';
  }
}

/** GeoJSON -> GML 字符串 */
export function geoJSONToGML(fc: FeatureCollection, docName?: string): string {
  const features = fc.features
    .map((f) => {
      const geom = (f as Feature).geometry;
      if (!geom) return '';
      return `<gml:featureMember><ogr:${docName ?? 'feature'} xmlns:ogr="http://ogr.maptools.org/">${geometryGml(geom)}</ogr:${docName ?? 'feature'}></gml:featureMember>`;
    })
    .join('\n');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<gml:FeatureCollection xmlns:gml="${GML_NS}" xmlns:ogr="http://ogr.maptools.org/" srsName="EPSG:4326">\n${features}\n</gml:FeatureCollection>`
  );
}

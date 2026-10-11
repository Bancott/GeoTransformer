import type { FeatureCollection, Feature, Position } from 'geojson';

/**
 * OSM XML（OpenStreetMap 数据格式）↔ GeoJSON（基础子集）。
 * 读取：node -> Point；way -> LineString（开放）或 Polygon（闭合且为面要素）。
 * 写出：Point -> node；LineString / Polygon -> way（闭合面自动带 area=yes）。
 */

/* ------------------------------ 读取 ------------------------------ */

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function tagProps(el: Element): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  const id = el.getAttribute('id');
  if (id != null) props.osm_id = Number(id);
  el.querySelectorAll('tag').forEach((t) => {
    const k = t.getAttribute('k');
    const v = t.getAttribute('v');
    if (k) props[k] = v ?? '';
  });
  return props;
}

function isArea(waysTags: Record<string, unknown>, closed: boolean): boolean {
  if (!closed) return false;
  const area = waysTags.area;
  const building = waysTags.building;
  const landuse = waysTags.landuse;
  const natural = waysTags.natural === 'water' || waysTags.natural === 'wood';
  const leisure = waysTags.leisure;
  const amenity = waysTags.amenity;
  const retail = Boolean([area, building, landuse, natural, leisure, amenity].some((v) => v != null));
  return retail;
}

/** OSM XML -> GeoJSON */
export function osmXmlToGeoJSON(text: string): FeatureCollection {
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('OSM XML 解析失败');

  // 建 node 表
  const nodeMap = new Map<number, Position>();
  doc.querySelectorAll('node').forEach((n) => {
    const id = Number(n.getAttribute('id'));
    const lat = Number(n.getAttribute('lat'));
    const lon = Number(n.getAttribute('lon'));
    if (Number.isFinite(id) && !Number.isNaN(lat) && !Number.isNaN(lon)) nodeMap.set(id, [lon, lat]);
  });

  const features: Feature[] = [];
  const wayProps = new Map<number, Record<string, unknown>>();

  doc.querySelectorAll('way').forEach((w) => {
    const id = Number(w.getAttribute('id'));
    const props = tagProps(w);
    wayProps.set(id, props);
    const refs = Array.from(w.querySelectorAll('nd'))
      .map((nd) => Number(nd.getAttribute('ref')))
      .map((ref) => nodeMap.get(ref))
      .filter((p): p is Position => p != null);
    if (refs.length < 2) return;
    const closed = refs.length >= 4 && refs[0][0] === refs[refs.length - 1][0] && refs[0][1] === refs[refs.length - 1][1];
    if (isArea(props, closed)) {
      features.push({ type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [refs.slice()] } });
    } else {
      features.push({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: refs } });
    }
  });

  // 未落入任何 way 的 node 作为独立 POI 点要素
  const used = new Set<number>();
  doc.querySelectorAll('way').forEach((w) =>
    Array.from(w.querySelectorAll('nd')).forEach((nd) => used.add(Number(nd.getAttribute('ref'))))
  );
  doc.querySelectorAll('node').forEach((n) => {
    const id = Number(n.getAttribute('id'));
    if (!nodeMap.has(id) || used.has(id)) return;
    const lat = Number(n.getAttribute('lat'));
    const lon = Number(n.getAttribute('lon'));
    if (Number.isNaN(lat) || Number.isNaN(lon)) return;
    features.push({
      type: 'Feature',
      properties: tagProps(n),
      geometry: { type: 'Point', coordinates: [lon, lat] },
    });
  });

  if (features.length === 0) throw new Error('OSM XML 中没有可解析的 node / way');
  return { type: 'FeatureCollection', features };
}

/* ------------------------------ 写出 ------------------------------ */

function fmt(n: number): string {
  return Number(n.toFixed(7)).toString();
}

function nodeXml(id: number, lon: number, lat: number): string {
  return `  <node id="${id}" lat="${fmt(lat)}" lon="${fmt(lon)}"/>`;
}

/** GeoJSON -> OSM XML 字符串 */
export function geoJSONToOsmXml(fc: FeatureCollection): string {
  let nodeId = 1;
  const nodes: string[] = [];
  const ways: string[] = [];
  const idOfCoord = new Map<string, number>();

  const ensureNode = (p: Position): number => {
    const key = `${p[0].toFixed(7)},${p[1].toFixed(7)}`;
    let id = idOfCoord.get(key);
    if (id == null) {
      id = nodeId++;
      idOfCoord.set(key, id);
      nodes.push(nodeXml(id, p[0], p[1]));
    }
    return id;
  };

  for (const f of fc.features as Feature[]) {
    const props = (f.properties ?? {}) as Record<string, unknown>;
    const geom = f.geometry;
    if (!geom) continue;
    const tagXml = (proto: Record<string, unknown>, closed = false): string => {
      const extras = closed ? { area: 'yes', ...proto } : proto;
      return Object.entries(extras)
        .filter(([k, v]) => v != null && k !== 'osm_id' && k !== '__row')
        .slice(0, 20)
        .map(([k, v]) => `      <tag k="${esc(k)}" v="${esc(v)}"/>`)
        .join('\n');
    };
    switch (geom.type) {
      case 'Point': {
        const p = geom.coordinates as Position;
        const id = ensureNode(p);
        const tagBlock = tagXml(props);
        const t = tagBlock ? `\n${tagBlock}\n  ` : '';
        ways.push(`  <node id="${id}" lat="${fmt(p[1])}" lon="${fmt(p[0])}">${t}</node>`);
        break;
      }
      case 'LineString': {
        const pts = geom.coordinates as Position[];
        const refs = pts.map(ensureNode);
        ways.push(
          `  <way id="${refs[0]}">\n${refs.map((r) => `    <nd ref="${r}"/>`).join('\n')}\n${tagXml(props)}\n  </way>`
        );
        break;
      }
      case 'MultiLineString': {
        const lines = geom.coordinates as Position[][];
        lines.forEach((pts) => {
          const refs = pts.map(ensureNode);
          ways.push(
            `  <way id="${refs[0]}">\n${refs.map((r) => `    <nd ref="${r}"/>`).join('\n')}\n${tagXml(props)}\n  </way>`
          );
        });
        break;
      }
      case 'Polygon': {
        const ring = (geom.coordinates as Position[][])[0] ?? [];
        const pts = ring.slice();
        if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
        const refs = pts.map(ensureNode);
        ways.push(
          `  <way id="${refs[0]}">\n${refs.map((r) => `    <nd ref="${r}"/>`).join('\n')}\n${tagXml(props, true)}\n  </way>`
        );
        break;
      }
      default:
        break;
    }
  }

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<osm version="0.6" generator="GeoTransformer">\n${nodes.join('\n')}\n${ways.join('\n')}\n</osm>`
  );
}

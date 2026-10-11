import { describe, it, expect } from 'vitest';
import { geoJSONToTopoJSON, topoJSONToGeoJSON } from '@/format/topojson';

const fc = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { name: 'a' },
      geometry: { type: 'Point', coordinates: [116.39, 39.9] },
    },
    {
      type: 'Feature',
      properties: { name: 'b' },
      geometry: { type: 'Point', coordinates: [121.47, 31.23] },
    },
  ],
} as const;

describe('topojson roundtrip', () => {
  it('GeoJSON -> TopoJSON -> GeoJSON 保持一致', () => {
    const topo = geoJSONToTopoJSON(fc as never, { quantization: 1e5 });
    expect(topo.type).toBe('Topology');
    const back = topoJSONToGeoJSON(topo as never);
    expect(back.features).toHaveLength(2);
    const c0 = (back.features[0].geometry as { coordinates: number[] }).coordinates;
    expect(c0[0]).toBeCloseTo(116.39, 2);
  });
});

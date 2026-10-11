import L from 'leaflet';
import type { FeatureCollection } from 'geojson';
import { BASEMAPS, DEFAULT_BASEMAP_ID, type Basemap } from '@/map/basemaps';
import { MAP_SYMBOL } from '@/map/mapStyle';
import { getBounds } from '@/format';
import { convertFeatureCollection, wgs84ToGcj02, gcj02ToWgs84 } from '@/core/coordTransform';
import type { CoordSystem } from '@/core/types';

export interface PickEvent {
  lng: number;
  lat: number;
  /** 点击时地图缩放级别 */
  zoom: number;
}

export interface PickMarker {
  lng: number;
  lat: number;
  label: string;
}

/**
 * 封装 Leaflet 地图：底图、数据图层、坐标拾取、坐标显示。
 *
 * 底图可能为 WGS-84 或 GCJ-02（高德）基准。当底图为 GCJ-02 时，
 * 瓦片本身与 WGS-84 存在数百米偏移，为保证数据正确显示：
 *  - 渲染数据 / 采集标记时，把 WGS-84 坐标换算为 GCJ-02 用于「显示」；
 *  - 地图点击 / 鼠标位置时，Leaflet 返回的是底图坐标（即 GCJ-02），再换算回 WGS-84。
 *  源数据始终以 WGS-84 为准，内部不变。
 */
export class MapController {
  private map: L.Map | null = null;
  private baseLayer: L.TileLayer | null = null;
  private dataLayer: L.LayerGroup | null = null;
  private pickMarker: L.Marker | null = null;
  private pickHandler: ((e: PickEvent) => void) | null = null;
  private moveHandler: ((e: PickEvent) => void) | null = null;
  private pickEnabled = false;
  /** 当前底图的坐标基准 */
  private baseSystem: CoordSystem = 'WGS84';
  /**
   * 当前数据的坐标基准（由调用方声明，默认 WGS84）。
   * 显示时按「源坐标系 → 底图坐标系」换算，而不是假定源一定是 WGS84；
   * 否则导入 GCJ-02 数据会被再偏移一次（在中国大陆约 500 m）。
   */
  private sourceSystem: CoordSystem = 'WGS84';
  /** 最近一次设置的源数据（WGS-84），用于底图切换时重绘 */
  private sourceFC: FeatureCollection | null = null;

  init(container: HTMLElement, center?: [number, number], zoom = 4): void {
    if (this.map) return;
    this.map = L.map(container, {
      center: center ?? [35, 105],
      zoom,
      zoomControl: true,
      worldCopyJump: true,
    });
    L.control.scale({ imperial: false }).addTo(this.map);
    this.dataLayer = L.layerGroup().addTo(this.map);
    this.setBasemap(DEFAULT_BASEMAP_ID);

    // 工具挂载时 mapHost 往往尚未 append 到文档，此时 Leaflet 会测到容器 0 尺寸，
    // 瓦片只按错误的初始尺寸铺在左上角、其余显示为灰色背景。
    // 等下一帧容器完成布局后重测一次，让瓦片按真实尺寸铺满。
    requestAnimationFrame(() => this.map?.invalidateSize());

    this.map.on('click', (e: L.LeafletMouseEvent) => {
      if (!this.pickEnabled) return;
      const [wgsLng, wgsLat] = this.fromDisplay([e.latlng.lng, e.latlng.lat]);
      this.placePickMarker([wgsLng, wgsLat], '采集点');
      this.pickHandler?.({ lng: wgsLng, lat: wgsLat, zoom: this.map!.getZoom() });
    });

    this.map.on('mousemove', (e: L.LeafletMouseEvent) => {
      if (!this.moveHandler) return;
      const [wgsLng, wgsLat] = this.fromDisplay([e.latlng.lng, e.latlng.lat]);
      this.moveHandler({ lng: wgsLng, lat: wgsLat, zoom: this.map!.getZoom() });
    });
  }

  /** 底图坐标判断：WGS-84 或 GCJ-02 */
  getBaseSystem(): CoordSystem {
    return this.baseSystem;
  }

  setBasemap(id: string): Basemap {
    const def = BASEMAPS.find((b) => b.id === id) ?? BASEMAPS[0];
    if (this.baseLayer) this.map?.removeLayer(this.baseLayer);
    this.baseLayer = L.tileLayer(def.url, def.options);
    this.map?.addLayer(this.baseLayer);
    const prev = this.baseSystem;
    this.baseSystem = def.system === 'GCJ02' ? 'GCJ02' : 'WGS84';
    // 底图基准变化时，重绘已有数据以保持对齐
    if (prev !== this.baseSystem && this.sourceFC && this.dataLayer) {
      this.renderData(this.sourceFC, false);
    }
    return def;
  }

  getBasemaps(): Basemap[] {
    return BASEMAPS;
  }

  getMap(): L.Map | null {
    return this.map;
  }

  /** 生成一个底图切换下拉框（切换后自动重绘当前数据以保持对齐） */
  createBasemapSelect(initial?: string): HTMLSelectElement {
    const sel = document.createElement('select');
    sel.className = 'gt-input';
    for (const b of BASEMAPS) {
      const opt = document.createElement('option');
      opt.value = b.id;
      opt.textContent = b.name;
      if (b.system === 'GCJ02') opt.textContent += '（GCJ-02）';
      sel.appendChild(opt);
    }
    sel.value = initial ?? DEFAULT_BASEMAP_ID;
    sel.addEventListener('change', () => {
      const def = this.setBasemap(sel.value);
      if (def.system === 'GCJ02') {
        // 切换底图基准后数据会按新基准自动重绘
      } else {
        this.renderData(this.sourceFC ?? { type: 'FeatureCollection', features: [] }, false);
      }
    });
    return sel;
  }

  /** 把 WGS-84 坐标换算为「底图坐标」用于显示 */
  private toDisplay(pos: [number, number]): [number, number] {
    return this.baseSystem === 'GCJ02' ? wgs84ToGcj02(pos[0], pos[1]) : pos;
  }

  /** 把「底图坐标（Leaflet 返回）」换算回 WGS-84 */
  private fromDisplay(pos: [number, number]): [number, number] {
    return this.baseSystem === 'GCJ02' ? gcj02ToWgs84(pos[0], pos[1]) : pos;
  }

  /** 数据当前的坐标基准 */
  getSourceSystem(): CoordSystem {
    return this.sourceSystem;
  }

  /** 生成显示用 GeoJSON：把源坐标系下的坐标换算到当前底图坐标系（不改源数据） */
  private displayFC(fc: FeatureCollection): FeatureCollection {
    return convertFeatureCollection(fc, this.sourceSystem, this.baseSystem);
  }

  /**
   * 展示 GeoJSON 数据，可选自动适配视野。
   * @param sourceSystem 数据自身的坐标系（默认沿用上次设定，初始 WGS84）
   */
  setData(fc: FeatureCollection, fit = true, sourceSystem: CoordSystem = this.sourceSystem): void {
    this.sourceFC = fc;
    this.sourceSystem = sourceSystem;
    if (!this.dataLayer) return;
    this.renderData(fc, fit);
  }

  private renderData(fc: FeatureCollection, fit: boolean): void {
    if (!this.dataLayer) return;
    this.dataLayer.clearLayers();
    const display = this.displayFC(fc);
    const layer = L.geoJSON(display as never, {
      style: () => ({
        color: MAP_SYMBOL.stroke,
        weight: MAP_SYMBOL.strokeWeight,
        opacity: MAP_SYMBOL.strokeOpacity,
        fillColor: MAP_SYMBOL.fill,
        fillOpacity: MAP_SYMBOL.fillOpacity,
      }),
      pointToLayer: (_feature, latlng) =>
        L.circleMarker(latlng, {
          radius: MAP_SYMBOL.pointRadius,
          color: MAP_SYMBOL.pointStroke,
          fillColor: MAP_SYMBOL.pointFill,
          fillOpacity: MAP_SYMBOL.pointFillOpacity,
          weight: MAP_SYMBOL.strokeWeight,
        }),
      onEachFeature: (feature, layer) => {
        if (feature?.properties && layer instanceof L.Marker === false) {
          layer.bindPopup(Object.keys(feature.properties).length
            ? `<pre style="max-height:200px;overflow:auto;margin:0">${escapeHtml(
                JSON.stringify(feature.properties, null, 2)
              )}</pre>`
            : '（无属性）');
        }
      },
    });
    layer.addTo(this.dataLayer);
    if (fit) this.fitBounds(display);
  }

  clearData(): void {
    this.sourceFC = null;
    this.dataLayer?.clearLayers();
  }

  fitBounds(fc: FeatureCollection): void {
    const b = getBounds(fc);
    if (!Number.isFinite(b[0])) return;
    const bounds = L.latLngBounds([b[1], b[0]], [b[3], b[2]]);
    if (!bounds.isValid()) return;
    this.map?.fitBounds(bounds, { padding: [24, 24], maxZoom: 18 });
  }

  setPickEnabled(enabled: boolean): void {
    this.pickEnabled = enabled;
  }

  setPickHandler(handler: ((e: PickEvent) => void) | null): void {
    this.pickHandler = handler;
  }

  setMoveHandler(handler: ((e: PickEvent) => void) | null): void {
    this.moveHandler = handler;
  }

  /** 在地图上放置采集标记（传入 WGS-84，按底图基准换算后显示） */
  placePickMarker(lnglat: [number, number], label: string): void {
    if (this.pickMarker) this.map?.removeLayer(this.pickMarker);
    const icon = L.divIcon({
      className: 'gt-pick-marker',
      html: '<span class="gt-pick-marker__dot"></span><span class="gt-pick-marker__label"></span>',
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });
    const display = this.toDisplay(lnglat);
    this.pickMarker = L.marker(display, { icon }).addTo(this.map!).setZIndexOffset(1000);
    this.pickMarker.bindPopup(label);
  }

  collectPickMarkers(): PickMarker[] {
    if (!this.pickMarker) return [];
    const p = this.pickMarker.getLatLng();
    return [{ lng: p.lng, lat: p.lat, label: '采集点' }];
  }

  destroy(): void {
    this.map?.remove();
    this.map = null;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

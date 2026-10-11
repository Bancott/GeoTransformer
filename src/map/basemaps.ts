import type { TileLayerOptions } from 'leaflet';

export type BasemapSystem = 'WGS84' | 'GCJ02';

export interface Basemap {
  id: string;
  name: string;
  url: string;
  /** 底图瓦片所使用的坐标基准。GCJ-02（高德/腾讯）瓦片与 WGS-84 存在小幅偏移。 */
  system: BasemapSystem;
  options: TileLayerOptions;
}

/**
 * 底图列表。
 * 高德瓦片为 GCJ-02 基准，已作为默认底图（国内体验更佳）；
 * 其余 OSM / Esri / Carto / OpenTopo 为 WGS-84 基准，用于对照校验，
 * 避免 GCJ/BD 坐标在小范围内产生偏移误导。
 */
export const BASEMAPS: Basemap[] = [
  {
    id: 'gaode-street',
    name: '高德地图 · 街道',
    url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
    system: 'GCJ02',
    options: {
      maxZoom: 18,
      subdomains: '1234',
      attribution: '&copy; 高德地图（Amap）',
    },
  },
  {
    id: 'gaode-imagery',
    name: '高德地图 · 卫星',
    url: 'https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}',
    system: 'GCJ02',
    options: {
      maxZoom: 18,
      subdomains: '1234',
      attribution: '&copy; 高德地图（Amap）',
    },
  },
  {
    id: 'osm',
    name: 'OpenStreetMap',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    system: 'WGS84',
    options: {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  {
    id: 'esri-street',
    name: 'Esri 世界街道图',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    system: 'WGS84',
    options: {
      maxZoom: 19,
      attribution: 'Tiles &copy; Esri',
    },
  },
  {
    id: 'esri-imagery',
    name: 'Esri 卫星影像',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    system: 'WGS84',
    options: {
      maxZoom: 19,
      attribution: 'Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics',
    },
  },
  {
    id: 'topo',
    name: 'OpenTopoMap 地形',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    system: 'WGS84',
    options: {
      maxZoom: 17,
      attribution: 'Map data &copy; OpenStreetMap contributors, SRTM | &copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
    },
  },
  {
    id: 'carto-light',
    name: 'Carto 浅色',
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    system: 'WGS84',
    options: {
      maxZoom: 20,
      subdomains: 'abcd',
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    },
  },
  {
    id: 'carto-dark',
    name: 'Carto 深色',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    system: 'WGS84',
    options: {
      maxZoom: 20,
      subdomains: 'abcd',
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    },
  },
];

/**
 * 默认底图：高德街道图（GCJ-02 基准，国内观感更好）。
 * 注意：底图**不随界面主题自动切换** —— 瓦片是数据，切换主题不应改变用户正在看的地图。
 * 需要深色底图时由用户在底图下拉中选「Carto 深色」。
 */
export const DEFAULT_BASEMAP_ID = 'gaode-street';

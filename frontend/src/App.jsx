import React, { useState, useEffect, useRef } from 'react';
import { MapContainer, ImageOverlay, GeoJSON, useMap, useMapEvents } from 'react-leaflet';
import { 
  Search, 
  ShieldCheck, 
  Map as MapIcon, 
  Eye, 
  Download, 
  Sliders, 
  Sparkles, 
  AlertCircle, 
  CheckCircle2, 
  Crosshair, 
  FileJson, 
  FileSpreadsheet, 
  Info,
  Layers,
  Globe2,
  TreePine,
  Waves,
  Building2,
  Mountain,
  Compass,
  ArrowRight,
  ZoomIn
} from 'lucide-react';

const API_BASE = 'http://127.0.0.1:8000';
const CONCEPT_DEMO_ID = 'concept_demo';
const DEMO_WIDTH = 320;
const DEMO_HEIGHT = 240;
const CONCEPT_DEMO_LOCATION = {
  location_id: CONCEPT_DEMO_ID,
  name: 'Concept Demo',
  badge_icon: '🎨',
  category: 'CHANGE DETECTION DEMO',
  description: 'Lightweight synthetic dataset for demonstrating the change-detection workflow.',
  reference_scene: { date: 'DEMO BEFORE' },
  target_scene: { date: 'DEMO AFTER' },
};

function drawDemoScene(ctx, after = false) {
  ctx.clearRect(0, 0, DEMO_WIDTH, DEMO_HEIGHT);
  ctx.fillStyle = '#b8956f'; ctx.fillRect(0, 0, DEMO_WIDTH, DEMO_HEIGHT);
  ctx.fillStyle = '#72965e'; ctx.fillRect(0, 0, 128, 108);
  ctx.fillStyle = '#238b45';
  ctx.beginPath(); ctx.arc(62, 58, after ? 30 : 42, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(112, 34, 21, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2563eb'; ctx.beginPath();
  ctx.moveTo(after ? 245 : 262, 0); ctx.lineTo(320, 0); ctx.lineTo(320, 240); ctx.lineTo(after ? 226 : 250, 240); ctx.bezierCurveTo(270, 185, 228, 118, after ? 245 : 262, 0); ctx.fill();
  ctx.fillStyle = '#707782'; ctx.fillRect(0, 130, after ? 252 : 215, 16);
  ctx.fillStyle = '#cbd5e1'; ctx.fillRect(8, 136, after ? 232 : 195, 3);
  ctx.fillStyle = '#64748b'; ctx.fillRect(105, 182, 34, 33);
  ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 3; ctx.strokeRect(105, 182, 34, 33);
  if (after) { ctx.fillStyle = '#64748b'; ctx.fillRect(160, 169, 32, 45); ctx.fillRect(205, 184, 30, 30); ctx.strokeStyle = '#e2e8f0'; ctx.strokeRect(160, 169, 32, 45); ctx.strokeRect(205, 184, 30, 30); }
}

function runDemoComparison() {
  const before = document.createElement('canvas'); before.width = DEMO_WIDTH; before.height = DEMO_HEIGHT;
  const after = document.createElement('canvas'); after.width = DEMO_WIDTH; after.height = DEMO_HEIGHT;
  drawDemoScene(before.getContext('2d'), false); drawDemoScene(after.getContext('2d'), true);
  const a = before.getContext('2d').getImageData(0, 0, DEMO_WIDTH, DEMO_HEIGHT).data;
  const b = after.getContext('2d').getImageData(0, 0, DEMO_WIDTH, DEMO_HEIGHT).data;
  const changed = new Uint8Array(DEMO_WIDTH * DEMO_HEIGHT);
  for (let i = 0; i < changed.length; i++) {
    const p = i * 4;
    changed[i] = Math.abs(a[p] - b[p]) + Math.abs(a[p + 1] - b[p + 1]) + Math.abs(a[p + 2] - b[p + 2]) > 48 ? 1 : 0;
  }
  const visited = new Uint8Array(changed.length); const regions = [];
  for (let start = 0; start < changed.length; start++) {
    if (!changed[start] || visited[start]) continue;
    const queue = [start]; visited[start] = 1; const pixels = []; let minX = DEMO_WIDTH, minY = DEMO_HEIGHT, maxX = 0, maxY = 0;
    for (let q = 0; q < queue.length; q++) {
      const pos = queue[q]; const x = pos % DEMO_WIDTH; const y = Math.floor(pos / DEMO_WIDTH); pixels.push(pos);
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].forEach(([nx, ny]) => {
        const ni = ny * DEMO_WIDTH + nx;
        if (nx >= 0 && nx < DEMO_WIDTH && ny >= 0 && ny < DEMO_HEIGHT && changed[ni] && !visited[ni]) { visited[ni] = 1; queue.push(ni); }
      });
    }
    if (pixels.length < 40) continue;
    const cx = (minX + maxX) / 2; const cy = (minY + maxY) / 2;
    const type = cx > 235 ? 'WATER EXTENT CHANGE' : cy >= 118 && cy <= 160 ? 'ROAD CHANGE' : cx < 145 && cy < 120 ? 'VEGETATION LOSS' : 'NEW CONSTRUCTION';
    const color = type === 'NEW CONSTRUCTION' ? '#ef4444' : type === 'ROAD CHANGE' ? '#facc15' : type === 'VEGETATION LOSS' ? '#22c55e' : '#38bdf8';
    const extent = Math.min(1, pixels.length / 1600); const shape = Math.min(1, pixels.length / Math.max(1, (maxX - minX + 1) * (maxY - minY + 1)));
    regions.push({ id: `demo-${regions.length + 1}`, is_demo: true, type, color, pixels, pixel_bbox: [minX, minY, maxX, maxY], area_pixels: pixels.length, confidence: Number((0.45 + 0.35 * extent + 0.2 * shape).toFixed(2)), explanation: `${type.replace(/_/g, ' ').replace('LOSS', 'CHANGE')} was detected by comparing the demo before and after canvases.`, dates: ['DEMO BEFORE', 'DEMO AFTER'] });
  }
  return regions.sort((x, y) => y.area_pixels - x.area_pixels);
}

// Fallback bounds
const DEFAULT_BOUNDS = [[26.14665, 91.72410], [26.19837, 91.77582]];

// Map synchronization helper
function MapSynchronizer({ center, zoom, onMapMoved }) {
  const map = useMap();
  const isMovingRef = useRef(false);

  useEffect(() => {
    if (center && zoom && !isMovingRef.current) {
      const currentCenter = map.getCenter();
      const currentZoom = map.getZoom();
      if (
        Math.abs(currentCenter.lat - center[0]) > 1e-5 ||
        Math.abs(currentCenter.lng - center[1]) > 1e-5 ||
        currentZoom !== zoom
      ) {
        map.setView(center, zoom, { animate: true });
      }
    }
  }, [center, zoom, map]);

  useMapEvents({
    movestart: () => {
      isMovingRef.current = true;
    },
    moveend: () => {
      isMovingRef.current = false;
      const c = map.getCenter();
      onMapMoved([c.lat, c.lng], map.getZoom());
    },
    zoomend: () => {
      isMovingRef.current = false;
      const c = map.getCenter();
      onMapMoved([c.lat, c.lng], map.getZoom());
    }
  });

  return null;
}

// Automatically fit map view to GeoTIFF bounds on load or location switch
function MapBoundsFitter({ bounds }) {
  const map = useMap();
  const prevBoundsRef = useRef(null);

  useEffect(() => {
    if (bounds && bounds.length === 2 && bounds[0] && bounds[1]) {
      const bStr = JSON.stringify(bounds);
      if (prevBoundsRef.current !== bStr) {
        map.fitBounds(bounds, { padding: [12, 12], maxZoom: 16 });
        prevBoundsRef.current = bStr;
      }
    }
  }, [bounds, map]);

  return null;
}

// Convert rasterio transform parameters to Leaflet lat/lon bounds
function getBoundsFromTransform(transform, width = 512, height = 512) {
  if (!transform) return DEFAULT_BOUNDS;
  const a = transform[0];
  const c = transform[2];
  const e = transform[4];
  const f = transform[5];
  const lonMin = c;
  const lonMax = c + (a * width);
  const latMax = f;
  const latMin = f + (e * height);
  return [[latMin, lonMin], [latMax, lonMax]];
}

// Evidence Canvas Cropper Component
function EvidenceCrop({ imgUrl, pixelBbox, label, pad = 24 }) {
  const canvasRef = useRef(null);
  
  useEffect(() => {
    if (!imgUrl || !pixelBbox) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const [minX, minY, maxX, maxY] = pixelBbox;
      const cropX = Math.max(0, minX - pad);
      const cropY = Math.max(0, minY - pad);
      const cropW = Math.min(img.width - cropX, (maxX - minX) + 2 * pad);
      const cropH = Math.min(img.height - cropY, (maxY - minY) + 2 * pad);
      
      canvas.width = 160;
      canvas.height = 160;
      ctx.clearRect(0, 0, 160, 160);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, 160, 160);
    };
    img.src = imgUrl;
  }, [imgUrl, pixelBbox, pad]);

  return (
    <div className="detail-thumb-box">
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
      <span className="detail-thumb-label">{label}</span>
    </div>
  );
}

function DemoCanvas({ mode, regions = [], selectedId, onSelect }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    canvas.width = DEMO_WIDTH; canvas.height = DEMO_HEIGHT; const ctx = canvas.getContext('2d');
    if (mode === 'change') {
      drawDemoScene(ctx, true); ctx.fillStyle = 'rgba(7,10,19,.62)'; ctx.fillRect(0, 0, DEMO_WIDTH, DEMO_HEIGHT);
      regions.forEach((region) => { ctx.fillStyle = `${region.color}${!selectedId || region.id === selectedId ? 'dd' : '20'}`; region.pixels.forEach((pixel) => { ctx.fillRect(pixel % DEMO_WIDTH, Math.floor(pixel / DEMO_WIDTH), 1, 1); }); });
    } else drawDemoScene(ctx, mode === 'after');
  }, [mode, regions, selectedId]);
  return <canvas ref={canvasRef} className="demo-scene-canvas" onClick={() => { if (mode === 'change' && onSelect) onSelect(regions[0]); }} />;
}

// Image Debug Info HUD
function ImageDebugBadge({ scene, title, bounds, metadata }) {
  const [showDetail, setShowDetail] = useState(false);
  if (!scene && !bounds && !metadata) return null;

  const w = scene?.width || 512;
  const h = scene?.height || 512;
  const crs = scene?.crs || 'EPSG:4326';
  const b = bounds || scene?.bounds || DEFAULT_BOUNDS;
  const south = b[0] ? b[0][0]?.toFixed(4) : '26.1448';
  const west = b[0] ? b[0][1]?.toFixed(4) : '91.7362';
  const north = b[1] ? b[1][0]?.toFixed(4) : '26.1960';
  const east = b[1] ? b[1][1]?.toFixed(4) : '91.7874';

  return (
    <div className="image-debug-container" onClick={() => setShowDetail(!showDetail)}>
      <div className="image-debug-pill">
        <Info size={11} />
        <span>{metadata || `${w}×${h} • ${crs} • 10m/px`}</span>
      </div>
      {showDetail && (
        <div className="image-debug-tooltip">
          <div className="debug-header">{title || 'Sentinel-2 Level-2A Raster'}</div>
          {metadata ? (
            <div>Lightweight conceptual image used for the change-detection demonstration.</div>
          ) : <>
            <div>Dimension: {w} × {h} px (4 Bands: B4,B3,B2,B8)</div>
            <div>CRS: {crs} (WGS84 Lat/Lon)</div>
            <div>Bounds: [{south}°N, {west}°E] to [{north}°N, {east}°E]</div>
            <div>Resolution: 10.0 meters/pixel (Sentinel-2 MSI)</div>
            {scene?.file_path && <div className="debug-path">Source: {scene.file_path}</div>}
          </>}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [locations, setLocations] = useState([]);
  // Keep the established Guwahati dashboard as the landing demonstration.
  // VIT-AP remains an equal, selectable AOI rather than a featured landing page.
  const [selectedLocId, setSelectedLocId] = useState('mixed');
  const [locationQuery, setLocationQuery] = useState('');
  const [scenes, setScenes] = useState([]);
  const [beforeSceneId, setBeforeSceneId] = useState('');
  const [afterSceneId, setAfterSceneId] = useState('');
  
  const [pipelineResult, setPipelineResult] = useState(null);
  const [changes, setChanges] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedChange, setSelectedChange] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [scenesLoading, setScenesLoading] = useState(true);
  
  // Overlay opacity slider (0.1 to 1.0)
  const [maskOpacity, setMaskOpacity] = useState(0.85);

  // Shared map view coordinates
  const [mapCenter, setMapCenter] = useState([26.1624, 91.7422]);
  const [mapZoom, setMapZoom] = useState(14);

  // Fetch locations and scenes on mount
  useEffect(() => {
    fetchInitialData();
  }, []);

  const fetchInitialData = async () => {
    setScenesLoading(true);
    try {
      // 1. Fetch multi-location index
      const locRes = await fetch(`${API_BASE}/locations`);
      if (locRes.ok) {
        const locData = await locRes.json();
        setLocations(locData);
        if (locData.length > 0) {
          const defaultLoc = locData.find((loc) => loc.location_id === 'mixed') || locData[0];
          setSelectedLocId(defaultLoc.location_id);
          applyLocation(defaultLoc);
        }
      }
    } catch (err) {
      console.error('Fetch initial data error:', err);
      setError('Offline Pipeline: Could not connect to local FastAPI backend.');
    } finally {
      setScenesLoading(false);
    }
  };

  const applyLocation = async (loc) => {
    setSelectedLocId(loc.location_id);
    setSelectedChange(null);
    setPipelineResult(null);
    setSearchQuery('');
    setChanges([]);
    setSearchResults([]);
    
    // Set center coordinates from location
    if (loc.center && loc.center.length === 2) {
      setMapCenter([loc.center[0], loc.center[1]]);
      setMapZoom(14);
    }
    
    // Fetch scenes for this location
    try {
      const res = await fetch(`${API_BASE}/scenes?location=${loc.location_id}`);
      if (res.ok) {
        const data = await res.json();
        setScenes(data);
        if (data.length >= 2) {
          setBeforeSceneId(data[0].id);
          setAfterSceneId(data[1].id);
        } else if (data.length > 0) {
          setBeforeSceneId(data[0].id);
          setAfterSceneId(data[0].id);
        }
      }
    } catch (err) {
      console.error('Fetch location scenes error:', err);
    }

    // Auto-load any pre-existing changes for this location from DB
    try {
      const chRes = await fetch(`${API_BASE}/changes?location=${loc.location_id}`);
      if (chRes.ok) {
        const existingChanges = await chRes.json();
        if (existingChanges.length > 0) {
          setChanges(existingChanges);
          setSearchResults(existingChanges);
        }
      }
    } catch (err) {
      // Silently ignore — changes will populate after running the pipeline
    }
  };

  const handleLocationChange = (locId) => {
    if (locId === CONCEPT_DEMO_ID) {
      setSelectedLocId(CONCEPT_DEMO_ID);
      setSelectedChange(null);
      setPipelineResult(null);
      setChanges([]);
      setSearchResults([]);
      setSearchQuery('');
      return;
    }
    const loc = locations.find(l => l.location_id === locId);
    if (loc) {
      applyLocation(loc);
    }
  };

  const handleLocationQueryChange = (query) => {
    setLocationQuery(query);
    if (query.trim().toLowerCase().includes('concept')) {
      handleLocationChange(CONCEPT_DEMO_ID);
    }
  };

  const handleRunPipeline = async () => {
    if (!isConceptDemo && (!beforeSceneId || !afterSceneId)) return;
    setLoading(true);
    setError(null);
    setSelectedChange(null);
    if (isConceptDemo) {
      // Run a genuine local canvas comparison, then reuse the existing results UI.
      window.setTimeout(() => {
        const demoChanges = runDemoComparison();
        const breakdown = demoChanges.reduce((acc, change) => ({ ...acc, [change.type]: (acc[change.type] || 0) + 1 }), {});
        setPipelineResult({ changes: demoChanges, changes_count: demoChanges.length, breakdown, total_area_sqkm: 'demo' });
        setChanges(demoChanges); setSearchResults(demoChanges); setLoading(false);
      }, 350);
      return;
    }
    try {
      const res = await fetch(
        `${API_BASE}/change-detect?before_id=${beforeSceneId}&after_id=${afterSceneId}&location_id=${selectedLocId}`,
        { method: 'POST' }
      );
      if (!res.ok) {
        throw new Error('Pipeline error during geospatial alignment / change detection.');
      }
      const data = await res.json();
      setPipelineResult(data);
      setChanges(data.changes);
      setSearchResults(data.changes);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async (queryText) => {
    setSearchQuery(queryText);
    if (!queryText.trim()) {
      setSearchResults(changes);
      return;
    }
    if (isConceptDemo) {
      const terms = queryText.toLowerCase().split(/\s+/);
      setSearchResults(changes.filter((change) => terms.some((term) => change.type.toLowerCase().includes(term) || change.explanation.toLowerCase().includes(term))));
      return;
    }
    
    try {
      const res = await fetch(
        `${API_BASE}/search?query=${encodeURIComponent(queryText)}&location=${selectedLocId}`,
        { method: 'POST' }
      );
      const data = await res.json();
      setSearchResults(data);
    } catch (err) {
      console.error('Search error', err);
    }
  };

  const handleSelectChange = (change) => {
    setSelectedChange(change);
    // Focus all map panes to change centroid
    if (change.centroid && change.centroid.length === 2) {
      setMapCenter([change.centroid[0], change.centroid[1]]);
      setMapZoom(16);
    } else if (change.geometry && change.geometry.coordinates && change.geometry.coordinates[0]) {
      const coords = change.geometry.coordinates[0];
      let latSum = 0, lonSum = 0;
      const count = coords.length - 1;
      for (let i = 0; i < count; i++) {
        lonSum += coords[i][0];
        latSum += coords[i][1];
      }
      setMapCenter([latSum / count, lonSum / count]);
      setMapZoom(16);
    }
  };

  const handleZoomToChange = () => {
    if (!selectedChange) return;
    if (selectedChange.centroid && selectedChange.centroid.length === 2) {
      setMapCenter([selectedChange.centroid[0], selectedChange.centroid[1]]);
      setMapZoom(17);
    }
  };

  const handleExport = (format) => {
    window.open(`${API_BASE}/export?format=${format}&location=${selectedLocId}`, '_blank');
  };

  // Location Icon Helper
  const getLocationIcon = (locId) => {
    switch (locId) {
      case 'forest': return <TreePine size={15} style={{ color: '#10b981' }} />;
      case 'river': return <Waves size={15} style={{ color: '#06b6d4' }} />;
      case 'urban': return <Building2 size={15} style={{ color: '#ef4444' }} />;
      case 'vit_ap': return <Building2 size={15} style={{ color: '#f59e0b' }} />;
      case 'mixed': return <Globe2 size={15} style={{ color: '#f59e0b' }} />;
      case 'wetland': return <Waves size={15} style={{ color: '#34d399' }} />;
      default: return <MapIcon size={15} />;
    }
  };

  // Quick preset queries based on current location
  const getPresets = () => {
    switch (selectedLocId) {
      case 'vit_ap':
        return ["New buildings", "Built-up expansion", "Construction near roads", "Road infrastructure"];
      case 'forest':
        return ["Forest canopy transition", "Vegetation loss", "Forest clearing", "Regeneration"];
      case 'river':
        return ["River shoreline shift", "Water extent change", "Sandbar dynamics", "Flood extent"];
      case 'urban':
        return ["New buildings", "Building expansion", "Construction near roads", "Built-up growth"];
      case 'wetland':
        return ["Water surface change", "Aquatic vegetation", "Wetland drying", "Shoreline transition"];
      default:
        return ["Forest loss", "River change", "New buildings", "Construction near roads", "Road expansion"];
    }
  };

  // Badge color style helper
  const getBadgeStyle = (type) => {
    switch (type) {
      case 'BUILDING CHANGE':
      case 'NEW CONSTRUCTION': return 'badge-construction';
      case 'ROAD CHANGE': return 'badge-road';
      case 'FOREST CHANGE':
      case 'VEGETATION LOSS':
      case 'VEGETATION CHANGE': return 'badge-veg';
      case 'RIVER CHANGE':
      case 'WATER EXTENT CHANGE':
      case 'WATER CHANGE': return 'badge-water';
      default: return 'badge-construction';
    }
  };

  // GeoJSON styling helper
  const getGeoJsonStyle = (changeItem) => {
    const isSelected = selectedChange && (
      (selectedChange.id && selectedChange.id === changeItem.id) ||
      (selectedChange.pixel_bbox && changeItem.pixel_bbox &&
       selectedChange.pixel_bbox.join() === changeItem.pixel_bbox.join())
    );
    
    const type = changeItem.type;
    let color = '#3b82f6';
    if (type === 'BUILDING CHANGE' || type === 'NEW CONSTRUCTION') color = '#ef4444';
    else if (type === 'ROAD CHANGE') color = '#f59e0b';
    else if (type === 'FOREST CHANGE' || type === 'VEGETATION CHANGE') color = '#10b981';
    else if (type === 'RIVER CHANGE' || type === 'WATER CHANGE') color = '#06b6d4';
    
    return {
      color: isSelected ? '#ffffff' : color,
      weight: isSelected ? 3.5 : 2,
      opacity: 0.95,
      fillColor: color,
      fillOpacity: isSelected ? 0.65 : 0.45,
      dashArray: isSelected ? '4, 4' : null
    };
  };

  const isConceptDemo = selectedLocId === CONCEPT_DEMO_ID;
  const selectedLoc = isConceptDemo
    ? CONCEPT_DEMO_LOCATION
    : locations.find(l => l.location_id === selectedLocId) || locations[0];
  const aoiLocations = [CONCEPT_DEMO_LOCATION, ...locations];
  const locationMatches = aoiLocations.filter((location) => {
    const searchable = `${location.name} ${location.description || ''} ${location.location_id}`.toLowerCase();
    return searchable.includes(locationQuery.trim().toLowerCase());
  });
  const beforeScene = scenes.find(s => s.id === beforeSceneId);
  const afterScene = scenes.find(s => s.id === afterSceneId);
  
  // Use actual scene bounds from DB (rasterio-derived) for most accurate map placement,
  // falling back to location index bounds, then default
  const currentBounds = beforeScene?.bounds || selectedLoc?.leaflet_bounds || DEFAULT_BOUNDS;
  const beforeImgUrl = beforeScene ? `${API_BASE}${beforeScene.image_url}` : null;
  const afterImgUrl = afterScene ? `${API_BASE}${afterScene.image_url}` : null;
  const alignedImgUrl = pipelineResult ? `${API_BASE}${pipelineResult.aligned_target_url}` : null;
  const changeMaskUrl = pipelineResult ? `${API_BASE}${pipelineResult.change_mask_url}` : null;

  return (
    <>
      <header>
        <div className="logo-section">
          <div className="logo-icon">
            <Sparkles size={20} />
          </div>
          <div>
            <div className="logo-text">ANTIGRAVITY CHANGE INTELLIGENCE</div>
            <div className="logo-subtext">Multi-Temporal &amp; Multi-Location Satellite Intelligence • Sentinel-2 MSI Level-2A</div>
          </div>
        </div>

        {/* Archive Summary Badge */}
        <div className="archive-summary-badge">
          <Globe2 size={13} style={{ color: '#60a5fa' }} />
          <span>MULTI-LOCATION ARCHIVE • 6 AOIs • REAL SENTINEL-2 • 100% OFFLINE</span>
        </div>

        <div className="header-actions">
          {(pipelineResult || changes.length > 0) && (
            <div className="export-btn-group">
              <button className="export-btn" onClick={() => handleExport('geojson')} title="Export GeoJSON">
                <Download size={13} />
                <span>GeoJSON</span>
              </button>
              <button className="export-btn" onClick={() => handleExport('csv')} title="Export Tabular CSV">
                <FileSpreadsheet size={13} />
                <span>CSV</span>
              </button>
              <button className="export-btn" onClick={() => handleExport('json')} title="Export Report JSON">
                <FileJson size={13} />
                <span>Report</span>
              </button>
            </div>
          )}
          
          <div className="health-badge">
            <ShieldCheck size={14} />
            <span>100% Offline AI</span>
          </div>
        </div>
      </header>

      {/* Workflow Guide Banner */}
      {!pipelineResult && !loading && (
        <div className="workflow-banner">
          <div className="workflow-banner-step active">
            <span className="wf-num">1</span>
            <span>Select AOI Location</span>
          </div>
          <div className="workflow-banner-arrow"><ArrowRight size={13} /></div>
          <div className={`workflow-banner-step ${scenes.length > 0 ? 'active' : ''}`}>
            <span className="wf-num">2</span>
            <span>Choose Observation Dates</span>
          </div>
          <div className="workflow-banner-arrow"><ArrowRight size={13} /></div>
          <div className="workflow-banner-step">
            <span className="wf-num">3</span>
            <span>Run Change Analytics</span>
          </div>
          <div className="workflow-banner-arrow"><ArrowRight size={13} /></div>
          <div className="workflow-banner-step">
            <span className="wf-num">4</span>
            <span>Explore Detected Changes</span>
          </div>
        </div>
      )}

      {loading && (
        <div className="workflow-banner processing">
          <span className="spinner" style={{ borderTopColor: '#60a5fa', borderColor: 'rgba(96,165,250,0.3)' }}></span>
          <span style={{ color: '#60a5fa', fontWeight: 600 }}>Running Sentinel-2 AI Pipeline — Alignment → Segmentation → Change Detection → Verification</span>
        </div>
      )}

      <div className="dashboard-container">
        {/* Left Sidebar - Location Selector & Analytics */}
        <div className="sidebar">
          {/* AOI Location Selection */}
          <div className="panel-section">
            <div className="section-title-row">
              <Compass size={15} />
              <h3>STEP 1 — SELECT LOCATION (AOI)</h3>
            </div>
            
            <div className="location-select-container">
              <div className="location-search-container">
                <Search size={13} />
                <input
                  value={locationQuery}
                  onChange={(event) => handleLocationQueryChange(event.target.value)}
                  placeholder="Find a place (e.g. VIT-AP, Guwahati)"
                  aria-label="Find a demonstration location"
                />
              </div>
              {locationQuery && locationMatches.length === 0 && <div className="location-search-empty">No matching staged AOI.</div>}
            </div>

            {selectedLoc && (
              <div className="location-desc-box">
                <div className="location-cat-tag">
                  {getLocationIcon(selectedLoc.location_id)}
                  <span>{selectedLoc.category}</span>
                </div>
                <div className="location-desc-text">{selectedLoc.description}</div>
              </div>
            )}

            {!isConceptDemo && selectedLoc && (
              <div className="aoi-preview-card">
                <div className="aoi-preview-heading">SATELLITE AOI PREVIEW</div>
                <div className="aoi-preview-name">{selectedLoc.name}</div>
                {afterImgUrl ? (
                  <img
                    className="aoi-preview-image"
                    src={afterImgUrl}
                    alt={`Sentinel-2 AOI preview for ${selectedLoc.name}`}
                    loading="lazy"
                  />
                ) : (
                  <div className="aoi-preview-loading">Loading selected AOI…</div>
                )}
                <div className="aoi-preview-meta">
                  {selectedLoc.center?.[0]?.toFixed(4)}° N, {selectedLoc.center?.[1]?.toFixed(4)}° E
                </div>
              </div>
            )}

            {/* Quick-select AOI cards: the concept demo is intentionally one equal card. */}
            <>
            <div className="demo-cards-label">Quick Select AOIs:</div>
            <div className="demo-cards-grid">
              {locationMatches.map(loc => (
                <div 
                  key={loc.location_id}
                  className={`demo-loc-card ${selectedLocId === loc.location_id ? 'active' : ''}`}
                  onClick={() => handleLocationChange(loc.location_id)}
                  title={loc.description}
                >
                  <div className="demo-loc-card-header">
                    <span className="demo-loc-icon">{loc.badge_icon || '📍'}</span>
                    <span className="demo-loc-title">{loc.name.split('/')[0].trim()}</span>
                  </div>
                  <div className="demo-loc-cat">{loc.category}</div>
                  <div className="demo-loc-timeline">
                    {loc.location_id === CONCEPT_DEMO_ID
                      ? 'BEFORE → AFTER'
                      : `${loc.reference_scene?.date?.split('-')[0]} → ${loc.target_scene?.date?.split('-')[0]}`}
                  </div>
                </div>
              ))}
            </div>

            {/* Observation Dates Selection */}
            <div className="workflow-step-label" style={{ marginTop: 12 }}>
              <ArrowRight size={11} />
              <span>STEP 2 — Observation Dates</span>
            </div>
            <div className="scene-select-row">
              <div style={{ flex: 1 }}>
                <label className="field-label">{isConceptDemo ? 'Reference (Demo Before)' : 'Reference (T₁ — Before)'}</label>
                <select 
                  className="select-box"
                  value={beforeSceneId}
                  onChange={(e) => setBeforeSceneId(e.target.value)}
                  disabled={isConceptDemo}
                >
                  {isConceptDemo ? <option>DEMO BEFORE</option> : scenes.map(s => <option key={s.id} value={s.id}>{s.date}</option>)}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label className="field-label">{isConceptDemo ? 'Target (Demo After)' : 'Target (T₂ — After)'}</label>
                <select 
                  className="select-box"
                  value={afterSceneId}
                  onChange={(e) => setAfterSceneId(e.target.value)}
                  disabled={isConceptDemo}
                >
                  {isConceptDemo ? <option>DEMO AFTER</option> : scenes.map(s => <option key={s.id} value={s.id}>{s.date}</option>)}
                </select>
              </div>
            </div>
            
            <div className="workflow-step-label">
              <ArrowRight size={11} />
              <span>STEP 3 — Run Change Analysis</span>
            </div>
            <button 
              className="run-btn" 
              onClick={handleRunPipeline}
              disabled={loading || (!isConceptDemo && (!beforeSceneId || !afterSceneId))}
            >
              {loading ? (
                <span className="btn-loading">
                  <span className="spinner"></span> Processing Satellite Pipeline...
                </span>
              ) : (
                <span className="btn-loading"><Sparkles size={15} /> Run Change Analytics</span>
              )}
            </button>
            
            {error && (
              <div className="error-banner">
                <AlertCircle size={14} />
                <span>{error}</span>
              </div>
            )}
            </>
            
            {/* Analysis Summary Card */}
            {pipelineResult && (
              <div className="summary-card">
                <div className="summary-card-header">
                  <CheckCircle2 size={14} style={{ color: '#10b981' }} />
                  <span>Verified ({pipelineResult.total_area_sqkm} km² AOI)</span>
                </div>
                <div className="summary-breakdown-row">
                  <div className="stat-box">
                    <span className="stat-val">{pipelineResult.changes_count}</span>
                    <span className="stat-lbl">Changes</span>
                  </div>
                  <div className="stat-box">
                    <span className="stat-val" style={{ color: '#ef4444' }}>{pipelineResult.breakdown?.['BUILDING CHANGE'] || 0}</span>
                    <span className="stat-lbl">Building</span>
                  </div>
                  <div className="stat-box">
                    <span className="stat-val" style={{ color: '#10b981' }}>{pipelineResult.breakdown?.['FOREST CHANGE'] || 0}</span>
                    <span className="stat-lbl">Forest</span>
                  </div>
                  <div className="stat-box">
                    <span className="stat-val" style={{ color: '#06b6d4' }}>{pipelineResult.breakdown?.['RIVER CHANGE'] || 0}</span>
                    <span className="stat-lbl">River</span>
                  </div>
                  <div className="stat-box">
                    <span className="stat-val" style={{ color: '#f59e0b' }}>{pipelineResult.breakdown?.['ROAD CHANGE'] || 0}</span>
                    <span className="stat-lbl">Roads</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Semantic Search Panel */}
          {pipelineResult && (
            <div className="panel-section" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <div className="section-title-row">
                <Search size={15} />
                <h3>Semantic Search</h3>
              </div>
              
              <div className="search-container">
                <input 
                  type="text" 
                  placeholder={`Search ${selectedLoc?.name || 'changes'}...`} 
                  className="search-input"
                  value={searchQuery}
                  onChange={(e) => handleSearch(e.target.value)}
                />
                <div className="search-icon-btn">
                  <Search size={15} />
                </div>
              </div>

              <div className="preset-queries">
                {getPresets().map(p => (
                  <button 
                    key={p} 
                    className="preset-btn"
                    onClick={() => handleSearch(p)}
                  >
                    {p}
                  </button>
                ))}
              </div>
              
              <div className="results-header">
                <span>Verified Change Events ({searchResults.length})</span>
              </div>
              
              <div className="results-list">
                {searchResults.map((change, idx) => (
                  <div 
                    key={idx}
                    className={`result-card ${selectedChange === change ? 'selected' : ''}`}
                    onClick={() => handleSelectChange(change)}
                  >
                    <div className="result-header">
                      <span className={`badge ${getBadgeStyle(change.type)}`}>
                        {change.type}
                      </span>
                      <span className="confidence-text">
                        Score: {change.confidence}
                      </span>
                    </div>
                    
                    <div className="result-meta-row">
                      <span>Area: {change.is_demo ? `${change.area_pixels} demo px` : change.area_sqm ? `${change.area_sqm.toLocaleString()} m²` : `${change.area_pixels} px`}</span>
                      {change.distance_to_road_m < 999 && (
                        <span>Road: {change.distance_to_road_m}m</span>
                      )}
                    </div>
                    
                    {change.explanation && (
                      <div className="explanation-text">
                        {change.explanation}
                      </div>
                    )}
                  </div>
                ))}
                
                {searchResults.length === 0 && (
                  <div className="empty-results">
                    No changes matching current query.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Center Panel - Synchronized 3-Pane Leaflet Map Views */}
        <div className="map-workspace">
        <div className="maps-grid">
          {/* Pane 1: Reference Satellite Image (T1) */}
          <div className="map-pane">
            <div className="map-title">
              <Eye size={13} />
              <span>REFERENCE: {isConceptDemo ? 'DEMO BEFORE' : beforeScene ? beforeScene.date : 'T₁'}</span>
            </div>
            
            {isConceptDemo ? (
              <DemoCanvas mode="before" />
            ) : scenesLoading ? (
              <div className="map-placeholder">
                <span className="spinner"></span>
                <span>LOADING SATELLITE IMAGERY...</span>
              </div>
            ) : beforeImgUrl ? (
              <MapContainer 
                center={mapCenter} 
                zoom={mapZoom} 
                zoomControl={false}
                className="map-element"
              >
                <ImageOverlay url={beforeImgUrl} bounds={currentBounds} />
                <MapBoundsFitter bounds={currentBounds} />
                <MapSynchronizer center={mapCenter} zoom={mapZoom} onMapMoved={(c, z) => { setMapCenter(c); setMapZoom(z); }} />
              </MapContainer>
            ) : (
              <div className="map-placeholder">
                <AlertCircle size={18} style={{ color: '#ef4444', marginBottom: 8 }} />
                <span>SATELLITE IMAGERY UNAVAILABLE</span>
              </div>
            )}
            
            {isConceptDemo
              ? <ImageDebugBadge title="Demo Before Image" metadata={`${DEMO_WIDTH}×${DEMO_HEIGHT} • DEMO • CONCEPTUAL`} />
              : <ImageDebugBadge scene={beforeScene} title="Reference Sentinel-2 Scene" bounds={currentBounds} />}
          </div>

          {/* Pane 2: Target Satellite Image (T2) */}
          <div className="map-pane">
            <div className="map-title">
              <Eye size={13} />
              <span>TARGET: {isConceptDemo ? 'DEMO AFTER' : afterScene ? afterScene.date : 'T₂'} {!isConceptDemo && alignedImgUrl ? '(Aligned)' : ''}</span>
            </div>
            
            {isConceptDemo ? (
              <DemoCanvas mode="after" />
            ) : scenesLoading ? (
              <div className="map-placeholder">
                <span className="spinner"></span>
                <span>LOADING SATELLITE IMAGERY...</span>
              </div>
            ) : (alignedImgUrl || afterImgUrl) ? (
              <MapContainer 
                center={mapCenter} 
                zoom={mapZoom} 
                zoomControl={false}
                className="map-element"
              >
                <ImageOverlay url={alignedImgUrl || afterImgUrl} bounds={currentBounds} />
                <MapBoundsFitter bounds={currentBounds} />
                <MapSynchronizer center={mapCenter} zoom={mapZoom} onMapMoved={(c, z) => { setMapCenter(c); setMapZoom(z); }} />
              </MapContainer>
            ) : (
              <div className="map-placeholder">
                <AlertCircle size={18} style={{ color: '#ef4444', marginBottom: 8 }} />
                <span>SATELLITE IMAGERY UNAVAILABLE</span>
              </div>
            )}
            
            {isConceptDemo
              ? <ImageDebugBadge title="Demo After Image" metadata={`${DEMO_WIDTH}×${DEMO_HEIGHT} • DEMO • CONCEPTUAL`} />
              : <ImageDebugBadge scene={afterScene} title="Target Sentinel-2 Scene" bounds={currentBounds} />}
          </div>

          {/* Pane 3: Verified Change Mask Over Satellite Layer */}
          <div className="map-pane">
            <div className="map-title">
              <MapIcon size={13} />
              <span>DETECTED CHANGE MAP</span>
            </div>

            {/* Map Legend Overlay */}
            {pipelineResult && (
              <div className="map-floating-legend">
                <div className="legend-header">Change Legend</div>
                <div className="legend-item">
                  <span className="legend-dot dot-construction"></span>
                  <span>Building Change</span>
                </div>
                <div className="legend-item">
                  <span className="legend-dot dot-veg"></span>
                  <span>Forest Change</span>
                </div>
                <div className="legend-item">
                  <span className="legend-dot dot-water"></span>
                  <span>River / Water</span>
                </div>
                <div className="legend-item">
                  <span className="legend-dot dot-road"></span>
                  <span>Road Change</span>
                </div>
                <div className="opacity-slider-container">
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: 'var(--text-secondary)' }}>
                    <span>Overlay Opacity</span>
                    <span>{Math.round(maskOpacity * 100)}%</span>
                  </div>
                  <input 
                    type="range" 
                    min="0.1" 
                    max="1.0" 
                    step="0.05" 
                    value={maskOpacity} 
                    onChange={(e) => setMaskOpacity(parseFloat(e.target.value))}
                    className="opacity-slider"
                  />
                </div>
              </div>
            )}

            {isConceptDemo ? (
              pipelineResult ? (
                <DemoCanvas mode="change" regions={searchResults} selectedId={selectedChange?.id} onSelect={handleSelectChange} />
              ) : (
                <div className="map-placeholder">
                  <span>RUN CHANGE ANALYTICS TO DETECT CHANGES</span>
                </div>
              )
            ) : scenesLoading ? (
              <div className="map-placeholder">
                <span className="spinner"></span>
                <span>LOADING SATELLITE IMAGERY...</span>
              </div>
            ) : (beforeImgUrl || afterImgUrl) ? (
              <MapContainer 
                center={mapCenter} 
                zoom={mapZoom} 
                zoomControl={false}
                className="map-element"
              >
                {/* Base Satellite Imagery */}
                <ImageOverlay url={alignedImgUrl || afterImgUrl || beforeImgUrl} bounds={currentBounds} opacity={0.88} />
                
                {/* Transparent RGBA Change Mask layer */}
                {changeMaskUrl && (
                  <ImageOverlay url={changeMaskUrl} bounds={currentBounds} opacity={maskOpacity} />
                )}
                
                {/* Interactive Change Polygons */}
                {searchResults.map((change, idx) => (
                  <GeoJSON 
                    key={`${idx}-${selectedChange === change}`}
                    data={change.geometry}
                    style={() => getGeoJsonStyle(change)}
                    eventHandlers={{
                      click: () => handleSelectChange(change)
                    }}
                  />
                ))}
                
                <MapBoundsFitter bounds={currentBounds} />
                <MapSynchronizer center={mapCenter} zoom={mapZoom} onMapMoved={(c, z) => { setMapCenter(c); setMapZoom(z); }} />
              </MapContainer>
            ) : (
              <div className="map-placeholder">
                <AlertCircle size={18} style={{ color: '#ef4444', marginBottom: 8 }} />
                <span>SATELLITE IMAGERY UNAVAILABLE</span>
              </div>
            )}

            {isConceptDemo
              ? <ImageDebugBadge title="Demo Change Map" metadata={`${DEMO_WIDTH}×${DEMO_HEIGHT} • DEMO • CONCEPTUAL`} />
              : <ImageDebugBadge scene={beforeScene} title="Change Mask Composite" bounds={currentBounds} />}
          </div>
        </div>
        </div>

        {/* Right Sidebar - Evidence & Geospatial Details */}
        {selectedChange && (
          <div className="details-panel">
            <div className="panel-section">
              <div className="section-title-row">
                <Crosshair size={15} />
                <h3>Change Evidence Detail</h3>
              </div>
              
              <div className="result-header" style={{ marginBottom: '14px' }}>
                <span className={`badge ${getBadgeStyle(selectedChange.type)}`} style={{ fontSize: '0.85rem' }}>
                  {selectedChange.type === 'NEW CONSTRUCTION' ? 'NEW BUILT-UP / CONSTRUCTION CHANGE' : selectedChange.type}
                </span>
                <span className="confidence-pill">
                  Change Score: {selectedChange.confidence}
                </span>
              </div>

              <div className="change-intelligence-facts">
                <div><span>Reference</span><strong>{selectedChange.is_demo ? 'DEMO BEFORE' : beforeScene?.date || '—'}</strong></div>
                <div><span>Target</span><strong>{selectedChange.is_demo ? 'DEMO AFTER' : afterScene?.date || '—'}</strong></div>
                <div className="change-intelligence-location"><span>Location</span><strong>{selectedChange.is_demo ? 'Concept Demo Dataset' : selectedLoc?.name || 'Selected AOI'}</strong></div>
              </div>

              {/* Side-by-Side Evidential Satellite Sub-Crops */}
              {!selectedChange.is_demo ? <><div className="detail-section-label">Evidential Satellite Crops</div><div className="detail-thumb-container">
                <EvidenceCrop 
                  imgUrl={beforeImgUrl} 
                  pixelBbox={selectedChange.pixel_bbox} 
                  label={`Before (${beforeScene?.date?.split('-')[0] || 'T₁'})`} 
                />
                <EvidenceCrop 
                  imgUrl={alignedImgUrl || afterImgUrl} 
                  pixelBbox={selectedChange.pixel_bbox} 
                  label={`After (${afterScene?.date?.split('-')[0] || 'T₂'})`} 
                />
              </div></> : <div className="detail-section-label">Selected region highlighted on the demo change map</div>}
              
              {/* Observable Transition Explanation */}
              <div className="detail-box">
                <div className="detail-box-label">Observable Transition Explanation</div>
                <div className="detail-box-value" style={{ fontStyle: 'italic', fontSize: '0.82rem', color: '#e2e8f0' }}>
                  "{selectedChange.explanation}"
                </div>
              </div>

              {/* Real Geospatial Metrics Grid */}
              <div className="detail-section-label">Geospatial Metrics</div>
              <div className="metrics-grid">
                <div className="metric-tile">
                  <span className="metric-tile-label">Surface Area</span>
                  <span className="metric-tile-val">
                    {selectedChange.is_demo ? `${selectedChange.area_pixels} demo px` : selectedChange.area_sqm ? `${selectedChange.area_sqm.toLocaleString()} m²` : `${selectedChange.area_pixels} px`}
                  </span>
                </div>
                <div className="metric-tile">
                  <span className="metric-tile-label">Dist to Road</span>
                  <span className="metric-tile-val">
                    {selectedChange.distance_to_road_m < 999 ? `${selectedChange.distance_to_road_m} m` : 'N/A'}
                  </span>
                </div>
                <div className="metric-tile">
                  <span className="metric-tile-label">Dist to Water</span>
                  <span className="metric-tile-val">
                    {selectedChange.distance_to_water_m < 999 ? `${selectedChange.distance_to_water_m} m` : 'N/A'}
                  </span>
                </div>
                <div className="metric-tile">
                  <span className="metric-tile-label">Change Period</span>
                  <span className="metric-tile-val" style={{ fontSize: '0.82rem' }}>
                    {selectedChange.dates?.join(' → ') || '2024 → 2026'}
                  </span>
                </div>
              </div>

              {/* GIS Centroid & Bounding Box */}
              {!selectedChange.is_demo && selectedChange.bbox && <><div className="detail-section-label">Coordinates (WGS84 EPSG:4326)</div><div className="coords-box">
                {selectedChange.centroid && (
                  <div style={{ marginBottom: '6px', color: '#60a5fa', fontWeight: 600 }}>
                    Centroid: {selectedChange.centroid[0].toFixed(5)}° N, {selectedChange.centroid[1].toFixed(5)}° E
                  </div>
                )}
                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                  Lat: {selectedChange.bbox[1].toFixed(5)}° to {selectedChange.bbox[3].toFixed(5)}°<br/>
                  Lon: {selectedChange.bbox[0].toFixed(5)}° to {selectedChange.bbox[2].toFixed(5)}°
                </div>
              </div>
              </>}

              {!selectedChange.is_demo && <button className="zoom-btn" onClick={handleZoomToChange}>
                <ZoomIn size={14} />
                <span>Zoom to Change Region</span>
              </button>}
              
              {/* Quality & Suppression Checks */}
              <div className="detail-section-label">Verification Checks</div>
              <div className="suppression-list">
                {selectedChange.suppression_checks?.map((check, i) => (
                  <div key={i} className="suppression-item">
                    <CheckCircle2 size={12} style={{ color: '#10b981', flexShrink: 0 }} />
                    <span>{check.replace(/_/g, ' ')} passed</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

import sqlite3
import json
import os

DB_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'satellite.db'))

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    cursor = conn.cursor()
    
    # Check if scenes table exists and has location_id
    cursor.execute("PRAGMA table_info(scenes)")
    scene_cols = [row['name'] for row in cursor.fetchall()]
    if 'location_id' not in scene_cols:
        cursor.execute("DROP TABLE IF EXISTS scenes")

    # Create scenes table
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS scenes (
        id TEXT PRIMARY KEY,
        location_id TEXT DEFAULT 'mixed',
        name TEXT,
        file_path TEXT,
        mask_path TEXT,
        date TEXT,
        crs TEXT,
        transform TEXT,
        bounds TEXT,
        width INTEGER DEFAULT 512,
        height INTEGER DEFAULT 512,
        resolution REAL DEFAULT 10.0
    )
    ''')
    
    # Check if changes table exists and has location_id
    cursor.execute("PRAGMA table_info(changes)")
    columns = [row['name'] for row in cursor.fetchall()]
    if 'location_id' not in columns:
        cursor.execute("DROP TABLE IF EXISTS changes")
        
    # Create changes table with all GIS context fields
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS changes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        location_id TEXT DEFAULT 'mixed',
        type TEXT,
        confidence REAL,
        area_pixels INTEGER,
        area_sqm INTEGER DEFAULT 0,
        centroid TEXT,
        distance_to_road_m REAL DEFAULT 0.0,
        distance_to_water_m REAL DEFAULT 0.0,
        explanation TEXT DEFAULT '',
        geometry TEXT,
        bbox TEXT,
        pixel_bbox TEXT,
        dates TEXT,
        suppression_checks TEXT,
        relevance REAL DEFAULT 0.0
    )
    ''')
    
    conn.commit()
    conn.close()

def save_scene(scene_id, location_id, name, file_path, mask_path, date, crs, transform, bounds=None, width=512, height=512, resolution=10.0):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
    INSERT OR REPLACE INTO scenes (id, location_id, name, file_path, mask_path, date, crs, transform, bounds, width, height, resolution)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        scene_id,
        location_id or 'mixed',
        name,
        file_path,
        mask_path,
        date,
        crs,
        json.dumps(transform) if isinstance(transform, (list, tuple)) else str(transform),
        json.dumps(bounds) if isinstance(bounds, (list, tuple)) else str(bounds or ''),
        int(width),
        int(height),
        float(resolution)
    ))
    conn.commit()
    conn.close()

def get_all_scenes(location_id=None):
    conn = get_db()
    cursor = conn.cursor()
    if location_id:
        cursor.execute('SELECT * FROM scenes WHERE location_id = ?', (location_id,))
    else:
        cursor.execute('SELECT * FROM scenes')
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def get_scene(scene_id):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM scenes WHERE id = ?', (scene_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None

def save_changes(changes_list, location_id=None):
    conn = get_db()
    cursor = conn.cursor()
    if location_id:
        cursor.execute('DELETE FROM changes WHERE location_id = ?', (location_id,))
    else:
        cursor.execute('DELETE FROM changes')
        
    for change in changes_list:
        loc = change.get('location_id') or location_id or 'mixed'
        cursor.execute('''
        INSERT INTO changes (
            location_id, type, confidence, area_pixels, area_sqm, centroid,
            distance_to_road_m, distance_to_water_m, explanation,
            geometry, bbox, pixel_bbox, dates, suppression_checks
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            loc,
            change.get('type'),
            change.get('confidence'),
            change.get('area_pixels'),
            change.get('area_sqm', 0),
            json.dumps(change.get('centroid', [])),
            change.get('distance_to_road_m', 0.0),
            change.get('distance_to_water_m', 0.0),
            change.get('explanation', ''),
            json.dumps(change.get('geometry')),
            json.dumps(change.get('bbox')),
            json.dumps(change.get('pixel_bbox')),
            json.dumps(change.get('dates')),
            json.dumps(change.get('suppression_checks'))
        ))
    conn.commit()
    conn.close()

def get_all_changes(location_id=None):
    conn = get_db()
    cursor = conn.cursor()
    if location_id:
        cursor.execute('SELECT * FROM changes WHERE location_id = ?', (location_id,))
    else:
        cursor.execute('SELECT * FROM changes')
    rows = cursor.fetchall()
    conn.close()
    
    results = []
    for r in rows:
        d = dict(r)
        d['geometry'] = json.loads(d['geometry']) if d.get('geometry') else {}
        d['bbox'] = json.loads(d['bbox']) if d.get('bbox') else []
        d['pixel_bbox'] = json.loads(d['pixel_bbox']) if d.get('pixel_bbox') else []
        d['dates'] = json.loads(d['dates']) if d.get('dates') else []
        d['suppression_checks'] = json.loads(d['suppression_checks']) if d.get('suppression_checks') else []
        d['centroid'] = json.loads(d['centroid']) if d.get('centroid') else []
        if len(d['centroid']) == 2:
            d['centroid_lonlat'] = [d['centroid'][1], d['centroid'][0]]
        
        # Translate types to new naming convention
        if d.get('type') == 'BUILDING CHANGE':
            d['type'] = 'NEW CONSTRUCTION'
        elif d.get('type') == 'FOREST CHANGE':
            d['type'] = 'VEGETATION LOSS'
        elif d.get('type') == 'RIVER CHANGE':
            d['type'] = 'WATER EXTENT CHANGE'
            
        results.append(d)
    return results





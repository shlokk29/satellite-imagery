import numpy as np

def search_changes(query, changes, seg_after=None):
    """
    Search and rank detected changes based on a text query with proximity reasoning.
    query: string (e.g. "new buildings", "vegetation loss", "new construction near roads", "water expansion")
    changes: list of change dicts returned by detect_changes
    seg_after: (H, W) optional target segmentation map
    """
    query_raw = query.strip()
    query = query_raw.lower()
    
    if not query:
        return changes
        
    results = []
    
    # Proximity and category intent detection
    has_road_intent = any(w in query for w in ["road", "highway", "corridor", "transport", "street", "paved", "infrastructure"])
    has_building_intent = any(w in query for w in ["building", "construction", "structure", "built", "complex", "house", "development"])
    has_veg_intent = any(w in query for w in ["veg", "forest", "tree", "meadow", "clearing", "loss", "canopy", "green"])
    has_water_intent = any(w in query for w in ["water", "river", "basin", "lake", "retention", "reservoir", "stream", "flood"])
    has_proximity_road = any(w in query for w in ["near road", "near roads", "along road", "roadside", "corridor proximity"])
    has_proximity_water = any(w in query for w in ["near water", "near river", "waterfront", "riparian", "bank"])
    
    for change in changes:
        ctype = change.get('type', '')
        conf = float(change.get('confidence', 0.8))
        dist_road = float(change.get('distance_to_road_m', 999.0))
        dist_water = float(change.get('distance_to_water_m', 999.0))
        area_sqm = int(change.get('area_sqm', 0))
        
        relevance = 0.0
        match = False
        explanation = change.get('explanation', '')
        
        # 1. Proximity queries: "construction near roads"
        if has_proximity_road or (has_building_intent and has_road_intent and "near" in query):
            if ctype == "NEW CONSTRUCTION":
                if dist_road <= 60.0:
                    proximity_factor = max(0.0, 1.0 - (dist_road / 60.0))
                    relevance = round(0.70 + 0.30 * proximity_factor, 2)
                    match = True
                    explanation = f"High spatial relevance: New construction located {dist_road:.0f}m from road network (Area: {area_sqm:,} m²)."
                else:
                    relevance = 0.25
            elif ctype == "ROAD CHANGE":
                relevance = 0.40
                match = True
                explanation = "Direct road infrastructure change."
                
        # 2. Proximity queries: "vegetation loss near water"
        elif has_proximity_water or (has_veg_intent and has_water_intent and "near" in query):
            if ctype == "VEGETATION CHANGE":
                if dist_water <= 100.0:
                    proximity_factor = max(0.0, 1.0 - (dist_water / 100.0))
                    relevance = round(0.70 + 0.30 * proximity_factor, 2)
                    match = True
                    explanation = f"High spatial relevance: Vegetation loss located {dist_water:.0f}m from river corridor."
                else:
                    relevance = 0.25
            elif ctype == "WATER CHANGE":
                relevance = 0.40
                match = True
                explanation = "Direct water extent expansion."
                
        # 3. Direct Category Intent Matches
        elif has_building_intent and ctype == "NEW CONSTRUCTION":
            relevance = round(0.75 + 0.25 * conf, 2)
            match = True
            if not explanation:
                explanation = f"Matches building and construction detection ({area_sqm:,} m²)."
                
        elif has_road_intent and ctype == "ROAD CHANGE":
            relevance = round(0.75 + 0.25 * conf, 2)
            match = True
            if not explanation:
                explanation = f"Matches road network and transport corridor change ({area_sqm:,} m²)."
                
        elif has_veg_intent and ctype == "VEGETATION CHANGE":
            relevance = round(0.75 + 0.25 * conf, 2)
            match = True
            if not explanation:
                explanation = f"Matches vegetation canopy loss and land clearing ({area_sqm:,} m²)."
                
        elif has_water_intent and ctype == "WATER CHANGE":
            relevance = round(0.75 + 0.25 * conf, 2)
            match = True
            if not explanation:
                explanation = f"Matches water extent expansion and river basin change ({area_sqm:,} m²)."
                
        # 4. General / High-Confidence / Large Area queries
        elif any(w in query for w in ["change", "detection", "all", "significant", "intelligence", "alert", "anomaly", "large", "high"]):
            if "large" in query:
                size_factor = min(1.0, area_sqm / 15000.0)
                relevance = round(0.50 + 0.50 * size_factor, 2)
            else:
                relevance = round(conf * 0.85, 2)
            match = True
            if not explanation:
                explanation = f"General change event matching '{query_raw}'."
                
        if match or relevance > 0:
            res = change.copy()
            res['relevance'] = float(relevance)
            res['search_explanation'] = explanation
            results.append(res)
            
    # Sort results by relevance descending, then by confidence descending
    results = sorted(results, key=lambda x: (x['relevance'], x.get('confidence', 0)), reverse=True)
    return results


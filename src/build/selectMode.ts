/** Pure routing for left-clicks on the map while the idle tools (select / bulldoze) are active. */
export type MapClickAction = 'none' | 'select' | 'select-piste' | 'deselect' | 'bulldoze' | 'bulldoze-miss';

/** Only 'select' and 'bulldoze' handle map clicks here; 'select' NEVER edits terrain or places anything. */
export function routeMapClick(tool: string, hasBuilding: boolean, hasSelection: boolean, hasPiste = false): MapClickAction {
  if (tool === 'bulldoze') return hasBuilding ? 'bulldoze' : 'bulldoze-miss';
  if (tool !== 'select') return 'none';
  if (hasBuilding) return 'select';
  if (hasPiste) return 'select-piste';
  return hasSelection ? 'deselect' : 'none';
}

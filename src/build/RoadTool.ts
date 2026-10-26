import { NetKind } from '../world/Networks';
import { SegmentTool, type DragToolOptions } from './PathTool';

/** Road: must start at the road entry / extend existing road, max half-slope. */
export class RoadTool extends SegmentTool {
  constructor(o: DragToolOptions) { super(o, NetKind.Road); }
}

/** Rail: from the rail entry on the map edge; flat/half-slope only; serves a Train Station. */
export class RailTool extends SegmentTool {
  constructor(o: DragToolOptions) { super(o, NetKind.Rail); }
}

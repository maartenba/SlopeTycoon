import type { Networks } from '../world/Networks';
import { Layer } from '../world/Networks';
import type { NetworkProvider, PisteDifficulty } from '../sim/Coverage';

/** Adapt Networks to Coverage's provider. Networks difficulty is 0..3 (green=0); Coverage's is 1..4 with 0 = no piste. */
export function networkProviderFrom(networks: Networks): NetworkProvider {
  return {
    getPisteDifficultyAt(x, y): PisteDifficulty {
      if (x < 0 || y < 0 || x >= networks.size || y >= networks.size) return 0;
      const i = y * networks.size + x;
      if (!(networks.layers[i]! & (Layer.Ski | Layer.Mtb | Layer.Hike))) return 0;
      return (Math.min(3, networks.difficulty[i]!) + 1) as PisteDifficulty;
    },
    isConnectedBuilding: (id) => networks.accessProblem(id) === null,
  };
}

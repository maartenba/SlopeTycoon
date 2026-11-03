import * as THREE from 'three';
import { onPalette, paletteData } from '@/config/palette';
import { atmosTerrainUniforms } from './atmosphere/uniforms';
import { FOG_FRAG, FOG_PARS_FRAG, FOG_PARS_VERT, fogUniforms, fogVert } from './Fog';
import type { Grid } from '@/world/Grid';
import { CHUNK_SIZE } from '@/world/Grid';
import {
  TERRAIN_BUILD_BUDGET, TERRAIN_MACRO_CHUNKS, TERRAIN_MACRO_STEP, TERRAIN_MACRO_VIEW_HEIGHT, TEXTURE_SEED,
} from '@/config/balance';
import { buildTerrainGeometry, fillSnow, type TerrainGeometryData } from './TerrainGeometry';
import { createTerrainTextures, type TerrainTextures } from './textures';
import { LOD_HYSTERESIS, schmitt } from './lodSelect';

const VERT = /* glsl */ `
attribute float aSnow;
attribute float aKind;
attribute float aSteep;
attribute vec3 aSmooth;
attribute vec2 aWet;
attribute float aRock;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vSmooth;
varying float vSnow;
varying float vKind;
varying float vSteep;
varying vec2 vWet;
varying float vRock;
${FOG_PARS_VERT}
void main() {
  vWorld = position;
  vNormal = normal;
  vSmooth = aSmooth;
  vSnow = aSnow;
  vKind = aKind;
  vSteep = aSteep;
  vWet = aWet;
  vRock = aRock;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  ${fogVert('(modelViewMatrix * vec4(position, 1.0))')}
}`;

const FRAG = /* glsl */ `
uniform sampler2D tGrass, tMeadow, tBlossom, tDirt, tSnow, tRock, tGround;
uniform float uGroundN; // map size in tiles (0 = no ground mask)
uniform float uSnowline, uSpringBloom, uAutumn, uGrid;
uniform vec3 uEdge0, uEdge1, uEdge2, uEdge3; // piste edge-rope colours by difficulty (Settings > Colour palette)
uniform float uDetailFade; // ground cameras: 1 = micro-detail on (fades out with distance, 0 in iso so iso is unchanged)
uniform vec3 uLodTint; // debug: multiplies the final colour (1,1,1 = off)
uniform vec3 uSunDir, uSunColor, uSkyColor, uGroundColor, uHazeColor;
uniform vec4 uAtmA; // M7.0: x alpenglow amount, y alpenglow height (world y), z frost, w cloud-shadow strength (all 0 = the old look)
uniform vec4 uAtmB; // x time (frozen with reduced motion), yz cloud drift offset, w frost twinkle on/off
uniform vec3 uAlpColor;
#ifdef USE_SHADOWS
uniform sampler2DShadow tShadow;
uniform mat4 uShadowM;
uniform vec4 uShadowP; // x strength, y depth bias, z 1 / map size, w normal offset (world units)
// High tier sun shadow (docs/shadows.md): 5 fixed taps of hardware PCF (a wide soft penumbra, no screen-space noise), fades out at the window border
float sunShadow(vec3 wp, vec3 n) {
  if (uShadowP.x < 0.001) return 1.0;
  vec4 sc = uShadowM * vec4(wp + n * uShadowP.w, 1.0);
  vec3 p = sc.xyz;
  vec2 edge = min(p.xy, 1.0 - p.xy);
  float inside = smoothstep(0.0, 0.05, min(edge.x, edge.y));
  if (inside <= 0.0) return 1.0;
  float t = uShadowP.z * 1.2, z = p.z - uShadowP.y;
  float s = texture(tShadow, vec3(p.xy, z)) * 0.28;
  s += texture(tShadow, vec3(p.xy + vec2(t, t), z)) * 0.18;
  s += texture(tShadow, vec3(p.xy + vec2(-t, t), z)) * 0.18;
  s += texture(tShadow, vec3(p.xy + vec2(t, -t), z)) * 0.18;
  s += texture(tShadow, vec3(p.xy + vec2(-t, -t), z)) * 0.18;
  return mix(1.0, 1.0 - uShadowP.x * (1.0 - s), inside);
}
#endif
${FOG_PARS_FRAG}
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vSmooth;
varying float vSnow;
varying float vKind;
varying float vSteep;
varying vec2 vWet;
varying float vRock;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 hash2(vec2 p) { return vec2(hash(p), hash(p + vec2(17.3, 91.7))); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm2(vec2 p) {
  return vnoise(p) * 0.6 + vnoise(p * 2.1 + 7.0) * 0.4;
}
vec3 palette(float h, float bloom) {
  // meadow: white, yellow, pink, purple, blue, orange ; blossom: pinks, whites, lilac
  vec3 m;
  if (h < 0.1667) m = vec3(0.97, 0.97, 0.95);
  else if (h < 0.3333) m = vec3(0.98, 0.85, 0.25);
  else if (h < 0.5) m = vec3(0.95, 0.55, 0.72);
  else if (h < 0.6667) m = vec3(0.62, 0.38, 0.80);
  else if (h < 0.8333) m = vec3(0.38, 0.55, 0.92);
  else m = vec3(0.97, 0.58, 0.20);
  vec3 b;
  if (h < 0.34) b = vec3(0.97, 0.66, 0.78);
  else if (h < 0.67) b = vec3(0.99, 0.95, 0.96);
  else b = vec3(0.76, 0.66, 0.92);
  return mix(m, b, bloom);
}
void main() {
  float fwW = max(fwidth(vWorld.x), fwidth(vWorld.z)); // world units per pixel: every sub-pixel-frequency term below fades with it (no shimmer when the camera moves)
  if (vKind > 6.5) { // map-edge cliff skirt (M8): topsoil + turf lip, then horizontal rock strata (ledges, soft fractures), melting into the haze at the foot. World-space only (flicker-safe); each fine term fades with the pixel footprint.
    vec3 wn = normalize(vNormal);
    float d = max(vWet.x, 0.0);                       // depth below the rim (world units, per vertex)
    float along = vWorld.x + vWorld.z;
    float fwY = fwidth(vWorld.y);                     // world y per pixel
    float lc = vWorld.y * 0.42 + (vnoise(vec2(along * 0.09, 3.0)) - 0.5) * 1.6 + (vnoise(vec2(along * 0.31, vWorld.y * 0.2)) - 0.5) * 0.35; // wavy bedding planes
    float lid = floor(lc), lf = fract(lc);
    float h0 = hash(vec2(lid, 7.0)), h1 = hash(vec2(lid, 19.0));
    vec3 tone = h0 < 0.3 ? vec3(0.44, 0.35, 0.25) : h0 < 0.55 ? vec3(0.50, 0.46, 0.41) : h0 < 0.8 ? vec3(0.36, 0.30, 0.24) : vec3(0.55, 0.43, 0.30); // sandstone / grey / umber / ochre
    tone *= 0.9 + 0.2 * h1;
    float aaL = 1.0 - smoothstep(0.12, 0.5, fwY * 0.42 * 2.0); // bedding lines thinner than ~2 px fade out
    float lip = smoothstep(0.0, 0.14, lf) * (1.0 - smoothstep(0.7, 1.0, lf)); // each bed: bright top ledge, shaded under-lip
    tone *= mix(1.0, 0.78 + 0.34 * lip, aaL);
    tone *= 0.9 + 0.2 * vnoise(vec2(along * 0.4, vWorld.y * 0.8));  // grain
    float crack = smoothstep(0.62, 0.78, vnoise(vec2(along * 0.55, vWorld.y * 0.06 + h0 * 9.0))); // vertical fractures
    tone *= 1.0 - 0.22 * crack * (1.0 - smoothstep(0.1, 0.45, fwY * 0.06 * 8.0));
    float rimY = vWorld.y + d;
    float soil = 1.0 - smoothstep(0.35, 0.9 + 0.5 * vnoise(vec2(along * 0.5, 1.0)), d); // topsoil band under the rim, ragged lower edge
    vec3 earth = mix(vec3(0.26, 0.19, 0.13), vec3(0.34, 0.30, 0.17), vnoise(vec2(along * 0.7, 2.0)));
    float turf = 1.0 - smoothstep(0.05, 0.3 + 0.15 * vnoise(vec2(along * 1.3, 5.0)), d);
    bool snowy = rimY > uSnowline - 1.2;
    vec3 lipCol = snowy ? vec3(0.88, 0.92, 0.97) : vec3(0.30, 0.42, 0.17);
    vec3 col = mix(tone, earth, soil);
    col = mix(col, lipCol, turf);
    col *= mix(0.72, 1.0, smoothstep(0.0, 5.0, d));  // shade just under the lip
    float g = clamp((vWorld.y + 3.0) / 14.0, 0.0, 1.0);
    col *= mix(0.45, 1.0, smoothstep(0.0, 0.7, g));   // ambient occlusion toward the foot
    col = mix(vec3(0.12, 0.10, 0.09), col, smoothstep(-0.5, 0.3, g));
    float dw = max(dot(wn, uSunDir), 0.0);
    vec3 ambW = mix(uGroundColor, uSkyColor, 0.5);
    vec3 sk = col * (ambW + uSunColor * dw);
    sk = mix(uHazeColor, sk, 0.30 + 0.70 * smoothstep(-0.15, 0.6, g)); // melt into the background below the rim
    gl_FragColor = vec4(sk * uLodTint, 1.0);
    ${FOG_FRAG}
  #include <colorspace_fragment>
    return;
  }
  vec3 nf = normalize(vNormal);
  vec3 ns = normalize(vSmooth);
  vec3 n = normalize(mix(nf, ns, 0.92)); // mostly smooth normal: avoids straight diagonal banding; the 8 % facet normal keeps the tile structure readable
  vec2 uv = vWorld.xz * 0.25;
  vec3 grass = texture2D(tGrass, uv).rgb;
  vec3 meadow = texture2D(tMeadow, uv * 1.3).rgb;
  vec3 blossom = texture2D(tBlossom, uv * 1.3).rgb;
  vec3 dirt = texture2D(tDirt, uv).rgb;
  vec3 snow = texture2D(tSnow, uv * 0.8).rgb;
  vec3 rock = texture2D(tRock, uv * 0.5).rgb;
  // large-scale rock tone variation hides texture repetition
  rock *= 0.9 + 0.2 * vnoise(vWorld.xz * 0.15);
  rock *= mix(vec3(1.08, 0.97, 0.88), vec3(0.88, 0.96, 1.08), vnoise(vWorld.xz * 0.09 + 5.0)); // warm/cool rock tints

  float lowN = vnoise(vWorld.xz * 0.12);
  vec3 flowers = mix(meadow, blossom, uSpringBloom);
  float flowerAmt = clamp(0.12 + 0.55 * uSpringBloom + (lowN - 0.5) * 0.9, 0.0, 1.0); // meadow only in broad patches (was everywhere: speckle noise)
  vec3 base = mix(grass, flowers, smoothstep(0.35, 0.8, flowerAmt) * 0.8);
  // gentle large-scale tone patches
  base *= 0.93 + 0.14 * vnoise(vWorld.xz * 0.07 + 3.0);
  base *= 0.90 + 0.20 * vnoise(vWorld.xz * 0.022 + 40.0); // broad 30-60 tile brightness patches
  // patchy large-scale hue variation: lush blue-green <-> warm yellow-green meadow
  float hueN = vnoise(vWorld.xz * 0.035 + 21.0);
  base *= mix(vec3(0.86, 1.06, 1.0), vec3(1.14, 1.06, 0.82), hueN);
  base = mix(vec3(dot(base, vec3(0.333))), base, 1.0); // saturation neutral (was +18 %)

  // flower clusters: sparse multi-coloured dots in cluster areas
  float cluster = smoothstep(0.58, 0.80, fbm2(vWorld.xz * 0.12 + 11.0));
  float petals = 0.0;
  vec3 petalCol = vec3(1.0);
  {
    vec2 fp = vWorld.xz * 2.6;
    vec2 cell = floor(fp);
    vec2 fr = fract(fp);
    vec2 jit = 0.25 + 0.5 * hash2(cell);
    float d = length(fr - jit);
    float present = step(0.62, hash(cell + 31.0));
    float dot_ = (1.0 - smoothstep(0.12, 0.20, d)) * present * (1.0 - smoothstep(0.07, 0.16, fwW * 2.6));
    // each cluster favours one or two colours
    float clusterHue = hash(floor(vWorld.xz * 0.18 + 11.0));
    float h = fract(clusterHue + hash(cell + 5.0) * 0.35);
    petals = dot_ * cluster * smoothstep(0.2, 0.6, flowerAmt) * (1.0 - uAutumn * 0.8) * 0.75;
    petalCol = palette(h, uSpringBloom);
  }
  base = mix(base, mix(base, petalCol, 0.7), petals);
  // autumn: golden / brown shift for grass (applied to base before special tiles)
  vec3 autumnCol = mix(vec3(0.80, 0.56, 0.14), vec3(0.66, 0.28, 0.10), vnoise(vWorld.xz * 0.3)) * (0.6 + 0.8 * dot(grass, vec3(0.33)));
  base = mix(base, autumnCol, uAutumn * (1.0 - petals * 0.5));

  // ---- ground mask (pistes / trails / contact shadows): bilinear (LINEAR texture) + a world-space wobble so every edge is organic, soft and flicker-free
  float pisteW = 0.0, trailW = 0.0, pisteRaw = 0.0, trailRaw = 0.0, builtM = 0.0, pDiff = 0.0, bcRaw = 0.0;
  if (uGroundN > 0.5) {
    vec2 wob = (vec2(vnoise(vWorld.xz * 0.9), vnoise(vWorld.xz * 0.9 + 13.7)) - 0.5) * 0.55;
    vec4 gm = texture2D(tGround, (vWorld.xz + wob) / uGroundN);
    pisteRaw = gm.r; trailRaw = gm.g; builtM = texture2D(tGround, vWorld.xz / uGroundN).a;
    pisteW = smoothstep(0.30, 0.70, pisteRaw);
    trailW = smoothstep(0.52, 0.80, trailRaw);
    pDiff = gm.r > 0.02 ? floor(clamp(gm.b / gm.r * 4.0 - 1.0 + 0.5, 0.0, 3.0)) : 0.0;
    bcRaw = gm.b * (1.0 - smoothstep(0.0, 0.08, gm.r)); // backcountry route (B on a tile without a piste)
  }
  float fall = 0.0; // fall-line coordinate: mowing stripes run along the slope
  {
    vec2 dn = vSmooth.xz; float dl = length(dn);
    vec2 dir = dl > 0.02 ? dn / dl : vec2(0.0, 1.0);
    fall = dot(vWorld.xz, vec2(-dir.y, dir.x));
  }
  float stripeAA = 1.0 - smoothstep(0.15, 0.5, fwW * 4.0);
  float stripe = (sin(fall * 6.2832 * 1.4 + vnoise(vWorld.xz * 0.4) * 3.0) * 0.5 + 0.5) * stripeAA;
  // summer ski run: pale, closely mown grass with soft edges and low-contrast mowing stripes
  vec3 mown = mix(grass, base, 0.35) * vec3(1.10, 1.08, 0.88) + vec3(0.025, 0.03, 0.0);
  mown *= 0.96 + 0.07 * stripe;
  base = mix(base, mown, pisteW * 0.85);
  // MTB / hike trail: earthy gravel ribbon
  vec3 trailCol = mix(dirt, vec3(0.62, 0.52, 0.38), 0.45) * (0.92 + 0.14 * vnoise(vWorld.xz * 3.0));
  base = mix(base, trailCol, trailW * 0.9);
  if (vKind > 2.5 && vKind < 3.5) base = dirt;          // Dirt
  // Water bed (teal-tinted). Drawn only: the dark bed is masked by the per-vertex water share (vWet.x, 1/4 at a tile corner, 1/2 on an edge), so the square tile
  // corners round off like the water surface and the cut edge fades into a sandy / muddy band; a slow world-space wobble keeps the edge organic (flicker-safe).
  float bedM = 1.0;
  if (vKind > 1.5 && vKind < 2.5) {
    bedM = smoothstep(0.7, 1.0, vWet.x + (vnoise(vWorld.xz * 2.1 + 7.0) - 0.5) * 0.1);
    base = mix(base, mix(dirt, base, 0.15) * vec3(0.55, 0.75, 0.8), bedM);
  }
  else if (vKind > 3.5 && vKind < 4.5) base *= 0.82;    // Forest floor
  bool isLake = vKind > 1.5 && vKind < 2.5;
  bool isStream = vKind > 5.5 && vKind < 6.5;
  // sandy / pebble ring around lakes (shore tiles + lake rim)
  float shoreAmt = isLake ? (1.0 - bedM) * 0.9 : smoothstep(0.05, 0.45, vWet.x);
  vec3 sand = mix(vec3(0.80, 0.72, 0.52), vec3(0.70, 0.64, 0.52), smoothstep(0.45, 0.85, vnoise(vWorld.xz * 1.6 + 4.0)) * 0.7); // soft pebble patches (were hard grey blobs)
  sand *= 0.92 + 0.16 * vnoise(vWorld.xz * 5.0);
  base = mix(base, sand, shoreAmt * 0.9);
  // stream bed + banks: dark wet soil and pebbles
  vec3 wetSoil = mix(dirt, rock, 0.35 + 0.3 * vnoise(vWorld.xz * 3.1)) * vec3(0.52, 0.47, 0.42);
  if (isStream) base = mix(base, wetSoil, smoothstep(0.5, 0.9, vWet.y + (vnoise(vWorld.xz * 2.1 + 7.0) - 0.5) * 0.08)); // river bed: masked like the lake bed (bend corners round off into the wet bank)
  else base = mix(base, wetSoil, smoothstep(0.05, 0.5, vWet.y) * 0.55);

  // rock: smoothed per-vertex steepness + per-vertex rock weight (interpolated, so no per-tile sawtooth),
  // thresholded with multi-scale noise and a fine dither grain so the boundary is organic
  float rn = fbm2(vWorld.xz * 0.5) - 0.5;
  float grain = (hash(floor(vWorld.xz * 9.0)) - 0.5) * (1.0 - smoothstep(0.10, 0.28, fwW * 9.0)); // 1/9 tile cells: fade out once they get smaller than ~4 px
  float rockEdge = rn * 1.4 + grain * 0.35;
  float rockAmt = smoothstep(2.0, 3.2, vSteep + rockEdge);
  rockAmt = max(rockAmt, smoothstep(0.4, 0.75, vRock + rockEdge * 0.35));
  if (isStream) rockAmt *= 0.3;
  rockAmt *= 1.0 - shoreAmt * 0.97;
  rockAmt *= 1.0 - 0.95 * smoothstep(0.02, 0.12, max(vWet.x, vWet.y)); // banks next to water never turn into steep dark rock: the dug bank wall is sand / wet soil (no dark notch at concave corners)
  { // slope-aware richness (M8): steep ground dries out (olive / ochre), rock gets faint horizontal bedding with wavy planes (fades before it can go sub-pixel)
    base = mix(base, base * vec3(1.14, 0.98, 0.76) + vec3(0.012, 0.0, -0.01), smoothstep(0.7, 1.7, vSteep) * 0.4 * (1.0 - uAutumn));
    float bed = sin(vWorld.y * 5.5 + vnoise(vWorld.xz * 0.3) * 4.0) * 0.5 + 0.5;
    float aaB = 1.0 - smoothstep(0.15, 0.55, fwidth(vWorld.y) * 11.0);
    rock *= 1.0 + (bed - 0.5) * 0.26 * aaB * smoothstep(1.0, 2.6, vSteep);
    rock = mix(rock, rock * vec3(0.78, 0.72, 0.66), smoothstep(0.62, 0.8, vnoise(vWorld.xz * vec2(0.9, 0.9) + vWorld.y * 0.35)) * 0.5 * aaB); // faint dark streaks / fractures
  }
  vec3 col = mix(base, rock, rockAmt);

  float band = (vWorld.y - uSnowline) + (vnoise(vWorld.xz * 0.35) - 0.5) * 3.0;
  float alt = smoothstep(-0.8, 0.8, band);
  float shed = smoothstep(1.3, 2.5, vSteep + rn * 1.1);       // wind and gravity strip snow from steep faces: patchy, never a hard line
  float thin = (vnoise(vWorld.xz * 1.3 + 17.0) - 0.5) * 0.12; // thin cover breaks up into drifts and bare patches
  float snowAmt = max(0.4 * alt * (1.0 - 0.7 * rockAmt), smoothstep(0.02, 0.25, vSnow + thin * smoothstep(0.0, 0.08, vSnow)) * (1.0 - 0.5 * rockAmt));
  snowAmt *= 1.0 - 0.45 * shed;
  if (vKind > 4.5 && vKind < 5.5) snowAmt = 1.0;
  if (isStream) snowAmt *= 0.3;
  col = mix(col, snow, clamp(snowAmt, 0.0, 1.0));
  { // winter groomed run: corduroy stripes along the fall line, slightly brighter / cooler, soft edge; trails = packed tracks
    float groom = pisteW * snowAmt;
    col = mix(col, col * vec3(0.97, 0.99, 1.04) + vec3(0.01), groom * 0.8);
    col *= 1.0 - groom * 0.07 * stripe;
    col = mix(col, col * vec3(0.84, 0.82, 0.80), trailW * snowAmt * 0.5);
    float rim = smoothstep(0.12, 0.5, pisteRaw) * (1.0 - smoothstep(0.5, 0.85, pisteRaw)); // soft blue shoulder: the run reads on snow without a hard outline
    col = mix(col, col * vec3(0.70, 0.80, 0.95), rim * snowAmt);
    col = mix(col, col * vec3(0.9, 0.94, 1.0), smoothstep(0.7, 1.0, pisteRaw) * snowAmt * 0.3);
  }
  { // backcountry route: a soft violet track on the snow with a dashed edge (world-space dashes: no crawl)
    float bcW = smoothstep(0.35, 0.75, bcRaw);
    float dash = smoothstep(0.30, 0.50, fract((vWorld.x + vWorld.z) * 0.9)) * (1.0 - smoothstep(0.62, 0.82, fract((vWorld.x + vWorld.z) * 0.9)));
    float bEdge = (1.0 - smoothstep(0.0, clamp(fwW * 1.6, 0.10, 0.34), abs(bcRaw - 0.5))) * step(0.02, bcRaw);
    col = mix(col, col * vec3(0.86, 0.80, 0.97), bcW * 0.55);
    col = mix(col, vec3(0.55, 0.30, 0.80), bEdge * dash * 0.85);
  }
  { // difficulty edge line: thin coloured rope along both sides of a ski run (full-tile colours live in the 'Piste difficulty' overlay)
    float ew = clamp(fwW * 1.6, 0.10, 0.34); // edge half-width grows with the pixel footprint: never thinner than ~1.5 px (no hairline shimmer), still a thin rope up close
    float edge = (1.0 - smoothstep(0.0, ew, abs(pisteRaw - 0.5))) * step(0.02, pisteRaw);
    vec3 dc = pDiff < 0.5 ? uEdge0 : pDiff < 1.5 ? uEdge1 : pDiff < 2.5 ? uEdge2 : uEdge3;
    col = mix(col, dc, edge * 0.8);
  }
  // close-range micro-detail (ground cameras only): tiling procedural albedo grain + normal ripple, faded by distance (full < ~25 m, gone by ~45 m)
  // and by screen-space derivatives (each octave fades out before it can alias / shimmer).
  float detailK = uDetailFade * (1.0 - smoothstep(2.5, 4.5, distance(cameraPosition, vWorld)));
  vec2 detailG = vec2(0.0);
  if (detailK > 0.002) {
    float fw = fwW;
    vec2 p1 = vWorld.xz * 14.0, p2 = vWorld.xz * 41.0;
    float aa1 = 1.0 - smoothstep(0.2, 0.6, fw * 14.0), aa2 = 1.0 - smoothstep(0.2, 0.6, fw * 41.0);
    float m1 = vnoise(p1), m2 = vnoise(p2 + 5.0);
    float micro = (m1 - 0.5) * aa1 + (m2 - 0.5) * 0.7 * aa2;
    col *= 1.0 + micro * (0.22 - 0.15 * snowAmt) * detailK;
    detailG = vec2(vnoise(p1 + vec2(0.07, 0.0)) - m1, vnoise(p1 + vec2(0.0, 0.07)) - m1) * aa1 + vec2(vnoise(p2 + vec2(0.07, 5.0)) - m2, vnoise(p2 + vec2(0.0, 5.07)) - m2) * 0.5 * aa2;
    detailG *= detailK * (1.0 - 0.45 * snowAmt);
    col = mix(col, col * vec3(0.9, 0.86, 0.8), rockAmt * detailK * smoothstep(0.55, 0.8, m1)); // rock: dark crack specks
  }

  // relief light: lower the sun elevation for terrain only (noon sun is near-overhead and flattens the hills), keep its azimuth
  // night calm: moonlight is faint and bluish, so large-scale albedo / drift variation only reads as cloudy blotches + banding: damp it when dark
  float dayK = smoothstep(0.25, 0.55, uSkyColor.b);
  vec3 L = normalize(uSunDir * vec3(1.0, 0.5, 1.0) + vec3(0.0, 0.0, 0.18));
  { // snow drifts: low-frequency bump on the normal so snowfields have visible relief
    vec2 q = vWorld.xz * 0.55;
    float a0 = vnoise(q), gx = vnoise(q + vec2(0.2, 0.0)) - a0, gy = vnoise(q + vec2(0.0, 0.2)) - a0;
    float a1 = vnoise(q * 3.1 + 9.0), hx = vnoise(q * 3.1 + vec2(0.4, 0.0) + 9.0) - a1, hy = vnoise(q * 3.1 + vec2(0.0, 0.4) + 9.0) - a1;
    n = normalize(n + vec3(-(gx * 1.6 + hx * 0.7), 0.0, -(gy * 1.6 + hy * 0.7)) * snowAmt * 0.6 * mix(0.3, 1.0, dayK));
  }
  n = normalize(n + vec3(-detailG.x, 0.0, -detailG.y) * 1.2); // micro normal ripple (zero in iso)
  float ndl = dot(n, L);
  float diff = max(ndl, 0.0);
  diff = mix(diff, diff * 0.8 + 0.2 * (ndl * 0.5 + 0.5), 0.45); // wrap lighting: soft terminator
  // cheap analytic cavity term: steep faces + faces turned away from the sun read as shadowed valleys; cool tint in the shade
  float tilt = 1.0 - clamp(n.y, 0.0, 1.0);
  float away = smoothstep(0.1, -0.5, ndl);
  float ao = 1.0 - 0.22 * smoothstep(0.1, 0.55, tilt) - 0.12 * away;
  ao *= 1.0 - 0.32 * smoothstep(0.02, 0.9, builtM); // contact shadow (all tiers, 0 draw calls) under buildings, lift towers and tree clusters, from the ground mask A channel: soft, bilinear, no decals (M8: 0.22 -> 0.32 so objects sit on the ground)
  vec3 amb = mix(uGroundColor, uSkyColor, n.y * 0.5 + 0.5) * ao;
  vec3 shadeTint = mix(vec3(0.80, 0.88, 1.08), vec3(1.0), smoothstep(0.05, 0.55, diff)); // cool blue in shade, strongest on snow
  col *= mix(vec3(1.0), shadeTint, 0.45 + 0.55 * snowAmt);
  col *= 1.0 - 0.26 * snowAmt;                   // snow albedo: leave headroom so lighting can show relief instead of clipping to white
  col *= 1.0 + 0.015 * dayK * (sin(vWorld.y * 2.2) - 1.0);   // faint contour tone variation
  float sunSh = 1.0;
#ifdef USE_SHADOWS
  sunSh = sunShadow(vWorld, nf);
  amb *= mix(1.0, 0.9, 1.0 - sunSh); // shade is slightly deeper than the plain ambient (a little bounce is lost under a canopy)
  col *= mix(vec3(1.0), vec3(0.95, 0.98, 1.05), 1.0 - sunSh);
#endif
  vec3 lit = col * (amb + uSunColor * diff * 1.12 * sunSh);
  // snow sparkle: sparse glints on sunlit snow
  vec2 sc = floor(vWorld.xz * 17.0);
  float spark = step(0.985, hash(sc)) * step(0.5, hash(sc + 3.1)) * (1.0 - smoothstep(0.30, 0.60, fwW * 17.0));
  lit += vec3(0.55, 0.58, 0.62) * spark * snowAmt * smoothstep(0.35, 0.8, diff);
  { // close-range crystal glints: finer, sparser cells, only on sunlit snow and only up close (static in the world: no swimming)
    vec2 sc2 = floor(vWorld.xz * 70.0);
    float s2 = step(0.992, hash(sc2 + 7.7)) * (1.0 - smoothstep(0.15, 0.5, fwW * 70.0));
    lit += vec3(0.8, 0.84, 0.9) * s2 * snowAmt * smoothstep(0.3, 0.8, diff) * detailK;
  }
  { // atmosphere (M7.0): alpenglow on high snow facing a low sun, drifting cloud shadows, frost glints. World-space only (no screen-space noise); every term is 0 when the setting is Off
    if (uAtmA.x > 0.001) {
      float alpH = smoothstep(uAtmA.y, uAtmA.y + 5.0, vWorld.y + (vnoise(vWorld.xz * 0.4) - 0.5) * 3.0);
      float alpG = uAtmA.x * alpH * snowAmt * (0.3 + 0.7 * smoothstep(0.0, 0.55, ndl));
      lit = mix(lit, lit * vec3(1.22, 0.82, 0.8) + uAlpColor * 0.16, clamp(alpG, 0.0, 1.0));
    }
    if (uAtmA.w > 0.001) {
      vec2 cp = vWorld.xz * 0.022 + uAtmB.yz;
      float cn = vnoise(cp) * 0.6 + vnoise(cp * 2.3 + 5.0) * 0.4;
      lit *= mix(vec3(1.0), vec3(0.9, 0.94, 1.0), uAtmA.w * 1.5) * (1.0 - uAtmA.w * smoothstep(0.48, 0.74, cn));
    }
    if (uAtmA.z > 0.001) {
      vec2 fc = floor(vWorld.xz * 34.0);
      float fh = hash(fc + 11.3);
      float fs = step(0.93, fh) * (1.0 - smoothstep(0.2, 0.5, fwW * 34.0));
      float tw = mix(1.0, 0.55 + 0.45 * sin(uAtmB.x * 1.7 + fh * 40.0), uAtmB.w);
      lit += vec3(0.7, 0.85, 1.0) * fs * tw * snowAmt * uAtmA.z * smoothstep(0.1, 0.6, diff) * 0.9;
      lit = mix(lit, lit * vec3(0.95, 0.98, 1.04) + 0.02, uAtmA.z * snowAmt * 0.5);
    }
  }
  // aerial perspective: very light haze with orthographic depth (far side of the map sits a little closer to the sky colour)
  lit = mix(lit, uHazeColor, 0.15 * smoothstep(0.35, 1.0, gl_FragCoord.z) * step(uFogDensity, 0.0)); // perspective views use the real distance fog instead

  if (uGrid > 0.5) {
    vec2 f = abs(fract(vWorld.xz + 0.5) - 0.5);
    float w = fwW;
    float line = 1.0 - smoothstep(0.0, w, min(f.x, f.y));
    lit = mix(lit, vec3(0.05, 0.1, 0.2), line * 0.5);
  }
  gl_FragColor = vec4(lit * uLodTint, 1.0);
  ${FOG_FRAG}
  #include <colorspace_fragment>
}`;

const EMPTY_GROUND = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
EMPTY_GROUND.needsUpdate = true;

interface ChunkSlot {
  mesh: THREE.Mesh;
  built: boolean;
  stale: boolean;
  data: TerrainGeometryData | null;
}

export class TerrainMesh {
  readonly group = new THREE.Group();
  readonly material: THREE.ShaderMaterial;
  readonly textures: TerrainTextures;
  private readonly chunks: ChunkSlot[] = [];
  private readonly macros: ChunkSlot[] = [];
  private readonly cpr: number;
  private readonly mpr: number;
  private macroMode = false;
  /** chunk indices covered by every macro (for the atomic LOD swap) */
  private macroChunkIds: number[][] = [];
  private readonly macroSnowDirty = new Set<number>();
  readonly macroCapable: boolean;
  /** chunks (indices) that hold or neighbour built things: always drawn at full resolution, even in far LOD */
  private protectedChunks = new Set<number>();
  /** Chunks around the ground-level camera (ride views): drawn full-res on top of the far LOD like protected chunks. */
  private nearChunks = new Set<number>();
  private nearKey = -2;
  /** debug: never use the far LOD */
  forceFullRes = false;
  private lodColours = false;
  /** last measured rebuild cost (ms) of one chunk */
  lastRebuildMs = 0;

  constructor(private readonly grid: Grid, sun?: THREE.DirectionalLight) {
    this.cpr = grid.chunksPerRow;
    this.macroCapable = grid.size >= 256;
    this.mpr = Math.ceil(this.cpr / TERRAIN_MACRO_CHUNKS);
    this.textures = createTerrainTextures(TEXTURE_SEED);
    const sunDir = sun ? sun.position.clone().normalize() : new THREE.Vector3(0.5, 1, 0.3).normalize();
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.DoubleSide,
      uniforms: {
        tGrass: { value: this.textures.grass },
        tMeadow: { value: this.textures.meadow },
        tBlossom: { value: this.textures.blossom },
        tDirt: { value: this.textures.dirt },
        tSnow: { value: this.textures.snow },
        tRock: { value: this.textures.rock },
        tGround: { value: EMPTY_GROUND },
        uGroundN: { value: 0 },
        uSnowline: { value: 1000 },
        uSpringBloom: { value: 0 },
        uAutumn: { value: 0 },
        uGrid: { value: 0 },
        uDetailFade: { value: 0 },
        uEdge0: { value: new THREE.Vector3() }, uEdge1: { value: new THREE.Vector3() }, uEdge2: { value: new THREE.Vector3() }, uEdge3: { value: new THREE.Vector3() },
        uLodTint: { value: new THREE.Vector3(1, 1, 1) },
        uSunDir: { value: sunDir },
        uSunColor: { value: new THREE.Color(0.85, 0.76, 0.58) },
        uSkyColor: { value: new THREE.Color(0.46, 0.54, 0.68) },
        uGroundColor: { value: new THREE.Color(0.30, 0.26, 0.26) },
        ...fogUniforms,
        ...atmosTerrainUniforms,
        uHazeColor: { value: new THREE.Color().setRGB(0.663, 0.831, 0.961, THREE.SRGBColorSpace) },
        tShadow: { value: null }, uShadowM: { value: new THREE.Matrix4() }, uShadowP: { value: new THREE.Vector4() }, // replaced by ShadowRig.addReceiver (High tier)
      },
    });
    this.applyPalette();
    this.unPalette = onPalette(() => this.applyPalette());
    for (let i = 0; i < this.cpr * this.cpr; i++) this.chunks.push(this.makeSlot());
    if (this.macroCapable) {
      for (let i = 0; i < this.mpr * this.mpr; i++) { this.macros.push(this.makeSlot()); this.macroChunkIds.push([]); }
      for (let i = 0; i < this.cpr * this.cpr; i++) this.macroChunkIds[this.macroIndexOf(i)]!.push(i);
    }
    // Initial build of chunk meshes is lazy; first update() builds within budget.
    for (const c of this.chunks) c.stale = true;
    this.grid.consumeDirtyChunks();
  }

  /** Chunk indices that contain roads / paths / rails / pistes / buildings / lift parts. Expanded by one chunk in every direction. */
  setProtectedChunks(ids: Iterable<number>): void {
    const out = new Set<number>();
    for (const id of ids) {
      const cx = id % this.cpr, cy = Math.floor(id / this.cpr);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x >= 0 && y >= 0 && x < this.cpr && y < this.cpr) out.add(y * this.cpr + x);
      }
    }
    this.protectedChunks = out;
  }
  /**
   * Ride views: full-res chunks within `radius` tiles of (x, z) (150 m = 15 tiles by default: the chunks the circle touches). `null` clears (iso).
   * Only matters on macro-capable maps (far LOD); cheap to call every frame (recomputed when the chunk cell changes).
   */
  /** Ground cameras (perspective): 1 enables the close-range micro-detail; 0 (iso) leaves the shader output identical to before. */
  private unPalette: (() => void) | null = null;
  /** Piste edge colours (Settings > Colour palette): called at start and whenever the palette changes. */
  applyPalette(): void { const e = paletteData().edge, u = this.material.uniforms; for (let i = 0; i < 4; i++) (u[`uEdge${i}`]!.value as THREE.Vector3).set(e[i]![0], e[i]![1], e[i]![2]); }
  setDetailFade(v: number): void { this.material.uniforms.uDetailFade!.value = v; }

  /** Soft piste / trail / contact-shadow data (see groundMask.ts); null detaches. */
  setGroundMask(tex: THREE.Texture | null, size = 0): void {
    this.material.uniforms.tGround!.value = tex ?? EMPTY_GROUND;
    this.material.uniforms.uGroundN!.value = tex ? size : 0;
  }

  setNearFocus(x: number | null, z = 0, radius = 15): void {
    if (x === null) { if (this.nearChunks.size) this.nearChunks = new Set(); this.nearKey = -2; return; }
    const c0x = Math.max(0, Math.floor((x - radius) / CHUNK_SIZE)), c1x = Math.min(this.cpr - 1, Math.floor((x + radius) / CHUNK_SIZE));
    const c0y = Math.max(0, Math.floor((z - radius) / CHUNK_SIZE)), c1y = Math.min(this.cpr - 1, Math.floor((z + radius) / CHUNK_SIZE));
    const key = ((c0x * 64 + c1x) * 64 + c0y) * 64 + c1y;
    if (key === this.nearKey) return;
    this.nearKey = key;
    const out = new Set<number>();
    for (let cy = c0y; cy <= c1y; cy++) for (let cx = c0x; cx <= c1x; cx++) out.add(cy * this.cpr + cx);
    this.nearChunks = out;
  }
  get nearCount(): number { return this.nearChunks.size; }
  get protectedCount(): number { return this.protectedChunks.size; }
  isProtected(chunk: number): boolean { return this.protectedChunks.has(chunk); }

  /** Debug: tint far-LOD macros red, protected full-res chunks blue and ordinary full-res chunks green. */
  set showLodColours(on: boolean) {
    this.lodColours = on;
    const u = this.material.uniforms.uLodTint as THREE.IUniform<THREE.Vector3>;
    const hook = (slots: ChunkSlot[], rgb: [number, number, number], prot: boolean): void => {
      slots.forEach((sl, i) => {
        sl.mesh.onBeforeRender = on
          ? (): void => { const c = prot && this.protectedChunks.has(i) ? [0.45, 0.65, 1.2] as const : rgb; u.value.set(c[0], c[1], c[2]); }
          : ((): void => { u.value.set(1, 1, 1); });
      });
    };
    hook(this.macros, [1.25, 0.5, 0.5], false);
    hook(this.chunks, [0.6, 1.2, 0.6], true);
    if (!on) u.value.set(1, 1, 1);
  }
  get showLodColours(): boolean { return this.lodColours; }

  /** Snapshot for the render-state dump. */
  stats(): { macroMode: boolean; macroCapable: boolean; forceFullRes: boolean; chunksBuilt: number; chunksTotal: number; macrosBuilt: number; macrosTotal: number; protectedChunks: number; visibleFine: number; visibleMacro: number } {
    return {
      macroMode: this.macroMode, macroCapable: this.macroCapable, forceFullRes: this.forceFullRes,
      chunksBuilt: this.chunks.filter((c) => c.built).length, chunksTotal: this.chunks.length,
      macrosBuilt: this.macros.filter((c) => c.built).length, macrosTotal: this.macros.length,
      protectedChunks: this.protectedChunks.size,
      visibleFine: this.chunks.filter((c) => c.mesh.visible).length, visibleMacro: this.macros.filter((c) => c.mesh.visible).length,
    };
  }

  private makeSlot(): ChunkSlot {
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    mesh.visible = false;
    mesh.frustumCulled = true;
    mesh.matrixAutoUpdate = false;
    this.group.add(mesh);
    return { mesh, built: false, stale: true, data: null };
  }

  set snowline(v: number) { (this.material.uniforms.uSnowline as THREE.IUniform<number>).value = v; }
  get snowline(): number { return (this.material.uniforms.uSnowline as THREE.IUniform<number>).value; }
  set springBloom(v: number) { (this.material.uniforms.uSpringBloom as THREE.IUniform<number>).value = v; }
  get springBloom(): number { return (this.material.uniforms.uSpringBloom as THREE.IUniform<number>).value; }
  /** 0..1 autumn tint (golden/brown grass) */
  set autumn(v: number) { (this.material.uniforms.uAutumn as THREE.IUniform<number>).value = v; }
  get autumn(): number { return (this.material.uniforms.uAutumn as THREE.IUniform<number>).value; }
  set gridOverlay(on: boolean) { (this.material.uniforms.uGrid as THREE.IUniform<number>).value = on ? 1 : 0; }
  get gridOverlay(): boolean { return (this.material.uniforms.uGrid as THREE.IUniform<number>).value > 0.5; }

  private chunkOrigin(idx: number): [number, number] {
    return [(idx % this.cpr) * CHUNK_SIZE, Math.floor(idx / this.cpr) * CHUNK_SIZE];
  }

  private applyGeometry(slot: ChunkSlot, d: TerrainGeometryData): void {
    const old = slot.mesh.geometry;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(d.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(d.normals, 3));
    g.setAttribute('aSnow', new THREE.BufferAttribute(d.snow, 1));
    g.setAttribute('aKind', new THREE.BufferAttribute(d.kind, 1));
    g.setAttribute('aSteep', new THREE.BufferAttribute(d.steep, 1));
    g.setAttribute('aSmooth', new THREE.BufferAttribute(d.smoothNormals, 3));
    g.setAttribute('aWet', new THREE.BufferAttribute(d.wet, 2));
    g.setAttribute('aRock', new THREE.BufferAttribute(d.rock, 1));
    g.boundingBox = new THREE.Box3(new THREE.Vector3(...d.min), new THREE.Vector3(...d.max));
    g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
    slot.mesh.geometry = g;
    slot.data = d;
    slot.built = true;
    slot.stale = false;
    old.dispose();
  }

  private buildChunk(idx: number): void {
    const [x0, y0] = this.chunkOrigin(idx);
    const t = performance.now();
    this.applyGeometry(this.chunks[idx]!, buildTerrainGeometry(this.grid, x0, y0, CHUNK_SIZE, CHUNK_SIZE, 1));
    this.lastRebuildMs = performance.now() - t;
  }

  private buildMacro(idx: number): void {
    const span = CHUNK_SIZE * TERRAIN_MACRO_CHUNKS;
    const x0 = (idx % this.mpr) * span, y0 = Math.floor(idx / this.mpr) * span;
    const w = Math.min(span, this.grid.size - x0), h = Math.min(span, this.grid.size - y0);
    this.applyGeometry(this.macros[idx]!, buildTerrainGeometry(this.grid, x0, y0, w, h, TERRAIN_MACRO_STEP));
  }

  /**
   * Rewrites only the aSnow attribute of a chunk (no geometry rebuild) and queues the far-LOD macro mesh covering it.
   * NOTE: the chunk need not be built: at default zoom on 256 maps only macros are ever built, so the macro must be refreshed
   * regardless (previously an early `return` for unbuilt chunks left far-LOD terrain white all summer).
   */
  updateSnow(chunkIdx: number): void {
    const slot = this.chunks[chunkIdx];
    if (!slot) return;
    if (slot.built && slot.data) {
      const [x0, y0] = this.chunkOrigin(chunkIdx);
      fillSnow(this.grid, x0, y0, CHUNK_SIZE, CHUNK_SIZE, 1, slot.data.snow);
      (slot.mesh.geometry.getAttribute('aSnow') as THREE.BufferAttribute).needsUpdate = true;
    }
    if (this.macroCapable) this.macroSnowDirty.add(this.macroIndexOf(chunkIdx));
  }

  /** Rewrite the aSnow attribute of queued macro meshes in place (unbuilt macros read the live grid when built). */
  private flushMacroSnow(): void {
    if (this.macroSnowDirty.size === 0) return;
    const span = CHUNK_SIZE * TERRAIN_MACRO_CHUNKS;
    for (const idx of this.macroSnowDirty) {
      const m = this.macros[idx];
      if (!m || !m.built || !m.data) continue;
      const x0 = (idx % this.mpr) * span, y0 = Math.floor(idx / this.mpr) * span;
      fillSnow(this.grid, x0, y0, Math.min(span, this.grid.size - x0), Math.min(span, this.grid.size - y0), TERRAIN_MACRO_STEP, m.data.snow);
      (m.mesh.geometry.getAttribute('aSnow') as THREE.BufferAttribute).needsUpdate = true;
    }
    this.macroSnowDirty.clear();
  }

  private macroIndexOf(chunkIdx: number): number {
    const cx = chunkIdx % this.cpr, cy = Math.floor(chunkIdx / this.cpr);
    return Math.floor(cy / TERRAIN_MACRO_CHUNKS) * this.mpr + Math.floor(cx / TERRAIN_MACRO_CHUNKS);
  }

  /**
   * Call once per frame. `visibleWorldHeight` = camera view height in world units (viewHeight / zoom);
   * `onChunksDirty` receives the dirty chunk list consumed this frame (so props can refresh too).
   * large values on 256/512 maps switch to merged far-LOD meshes (16 meshes on 512 instead of 256).
   */
  update(visibleWorldHeight: number, onChunksDirty?: (dirty: number[]) => void): void {
    this.flushMacroSnow();
    const dirty = this.grid.consumeDirtyChunks();
    if (dirty.length > 0) onChunksDirty?.(dirty);
    for (const idx of dirty) {
      this.chunks[idx]!.stale = true;
      if (this.macroCapable) this.macros[this.macroIndexOf(idx)]!.stale = true;
    }
    this.macroMode = this.macroCapable && !this.forceFullRes && schmitt(this.macroMode, visibleWorldHeight, TERRAIN_MACRO_VIEW_HEIGHT * (1 - LOD_HYSTERESIS), TERRAIN_MACRO_VIEW_HEIGHT * (1 + LOD_HYSTERESIS));
    let budget = TERRAIN_BUILD_BUDGET;
    if (this.macroMode) {
      for (let i = 0; i < this.macros.length && budget > 0; i++) {
        if (!this.macros[i]!.stale) continue;
        this.buildMacro(i); budget--;
      }
      // full-res chunks around built things stay drawn on top of the (lowered) macro surface
      for (const set of [this.nearChunks, this.protectedChunks]) { // the ground-level camera's surroundings first
        for (const i of set) {
          if (budget <= 0) break;
          if (!this.chunks[i]!.stale) continue;
          this.buildChunk(i); budget--;
        }
      }
    } else {
      for (let i = 0; i < this.chunks.length && budget > 0; i++) {
        if (!this.chunks[i]!.stale) continue;
        this.buildChunk(i); budget--;
      }
    }
    // Atomic LOD swaps (no holes, no overdraw / z-fight between the two resolutions): entering the far LOD, a full-res chunk stays until ITS macro is built;
    // leaving it, a macro stays until every chunk of it is built. Protected / near chunks are always drawn on top of the macro surface.
    if (this.macroCapable) {
      const done = this.macros.map((_, mi) => this.macroChunkIds[mi]!.every((ci) => this.chunks[ci]!.built));
      this.chunks.forEach((s, i) => {
        const mi = this.macroIndexOf(i), top = this.protectedChunks.has(i) || this.nearChunks.has(i);
        s.mesh.visible = s.built && (top || (this.macroMode ? !this.macros[mi]!.built : done[mi]!));
      });
      this.macros.forEach((s, mi) => { s.mesh.visible = s.built && (this.macroMode || !done[mi]!); });
    } else this.chunks.forEach((s) => { s.mesh.visible = s.built; });
  }

  get lodActive(): boolean { return this.macroMode; }

  /** Number of terrain meshes (= draw calls) that pass frustum culling for this camera. */
  countVisible(camera: THREE.Camera): number {
    const f = new THREE.Frustum();
    f.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    let n = 0;
    for (const s of this.group.children as THREE.Mesh[]) {
      if (s.visible && s.geometry.boundingSphere && f.intersectsSphere(s.geometry.boundingSphere)) n++;
    }
    return n;
  }

  dispose(): void {
    this.unPalette?.(); this.unPalette = null;
    for (const s of [...this.chunks, ...this.macros]) s.mesh.geometry.dispose();
    this.material.dispose();
    for (const t of Object.values(this.textures)) t.dispose();
  }
}

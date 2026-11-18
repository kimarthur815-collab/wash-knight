// Wash Knight - temporary monster blob with per-vertex grime ("때 HP") and soap
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const RAD = [1, 0.86, 1];      // ellipsoid shape (unit radius = R)
const BOTTOM = -0.7;           // flattened base (unit space, after squash)
const SOAP_BOOST = 6;          // water removes grime (1 + 6 * soap) times faster on soaped spots

// ---------------------------------------------------------------- deterministic noise (CPU)
function hash(x, y, z, s) { const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + s * 19.19) * 43758.5453; return h - Math.floor(h); }
function vnoise(x, y, z, s) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let xf = x - xi, yf = y - yi, zf = z - zi;
  xf = xf * xf * (3 - 2 * xf); yf = yf * yf * (3 - 2 * yf); zf = zf * zf * (3 - 2 * zf);
  const L = (a, b, t) => a + (b - a) * t;
  const c = (i, j, k) => hash(xi + i, yi + j, zi + k, s);
  return L(L(L(c(0, 0, 0), c(1, 0, 0), xf), L(c(0, 1, 0), c(1, 1, 0), xf), yf), L(L(c(0, 0, 1), c(1, 0, 1), xf), L(c(0, 1, 1), c(1, 1, 1), xf), yf), zf);
}
const fbm = (x, y, z, s) => 0.62 * vnoise(x, y, z, s) + 0.38 * vnoise(x * 2.3, y * 2.3, z * 2.3, s + 7);
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const srgb = (hex) => new THREE.Vector3(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);

// ---------------------------------------------------------------- shaders
const WOBBLE = /* glsl */`
uniform float uTime, uJig;
vec3 wob(vec3 p, vec3 n) { return p + n * (sin(p.y * 7.0 + uTime * 2.6) * 0.010 + uJig * sin(p.x * 13.0 + p.z * 9.0 + uTime * 30.0) * 0.022); }`;
const NOISE = /* glsl */`
float h3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float vn(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z); }`;
const BODY_VS = /* glsl */`
attribute float aDirt; attribute float aSoap;
varying vec3 vN, vV, vP; varying float vD, vS;
${WOBBLE}
void main() {
  vec3 p = wob(position, normal);
  vP = position; vD = aDirt; vS = aSoap;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const BODY_FS = /* glsl */`
uniform vec3 uL, uBase, uShade, uDirtA, uDirtB; uniform float uTime, uShine;
varying vec3 vN, vV, vP; varying float vD, vS;
${NOISE}
void main() {
  vec3 N = normalize(vN), Vv = normalize(vV);
  float n1 = vn(vP * 9.0), n2 = vn(vP * 23.0 + 3.1);
  float d = vD + (n1 * 0.6 + n2 * 0.4 - 0.5) * 0.55;
  float grime = smoothstep(0.06, 0.32, d);
  float crust = smoothstep(1.1, 1.65, d);
  float ndl = dot(N, uL);
  float lit = smoothstep(-0.08, 0.04, ndl) * 0.62 + smoothstep(0.5, 0.58, ndl) * 0.38;
  vec3 col = mix(uShade, uBase, lit);
  vec3 dc = mix(uDirtA, uDirtB, crust) * mix(0.62, 1.0, lit) * (0.86 + 0.28 * n2);
  col = mix(col, dc, grime);
  float bub = vn(vP * 55.0);
  float foam = smoothstep(0.12, 0.45, vS + (bub - 0.5) * 0.35);
  col = mix(col, mix(vec3(0.80, 0.78, 0.90), vec3(1.0, 0.98, 1.0), lit), foam * 0.9);
  float rim = pow(1.0 - clamp(dot(N, Vv), 0.0, 1.0), 3.0);
  col += rim * 0.22 * (1.0 - grime * 0.8);
  vec3 H = normalize(uL + Vv);
  float sp = smoothstep(0.93, 0.965, dot(N, H)) * (1.0 - grime) * (1.0 - foam);
  float twinkle = uShine * smoothstep(0.82, 1.0, vn(vP * 30.0 + vec3(0.0, uTime * 3.0, 0.0))) * (1.0 - grime);
  col += sp * 0.45 + twinkle * 0.6;
  gl_FragColor = vec4(col, 1.0);
}`;
const OUTLINE_VS = /* glsl */`
uniform float uWidth; uniform vec2 uRes;
${WOBBLE}
void main() {
  vec3 p = wob(position, normal);
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  vec3 n = normalize(normalMatrix * normal);
  vec2 dir = (projectionMatrix * vec4(n, 0.0)).xy;
  float l = length(dir);
  dir = l > 1e-6 ? dir / l : vec2(0.0);
  clip.xy += dir * uWidth * 2.0 / uRes * clip.w;
  gl_Position = clip;
}`;

// ---------------------------------------------------------------- monster
export function createMonster(cfg, camPos, detail = 26) {
  const { R, seed = 1 } = cfg;
  // body geometry: noisy ellipsoid with a flat base
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-5);
  const pa = g.attributes.position, N = pa.count;
  for (let i = 0; i < N; i++) {
    const v = new THREE.Vector3(pa.getX(i), pa.getY(i), pa.getZ(i)).normalize();
    const k = 1 + 0.035 * (fbm(v.x * 2.2, v.y * 2.2, v.z * 2.2, seed) - 0.5) * 2;
    let x = v.x * k * RAD[0], y = v.y * k * RAD[1], z = v.z * k * RAD[2];
    if (y < BOTTOM) y = BOTTOM + (y - BOTTOM) * 0.12;
    pa.setXYZ(i, x * R, y * R, z * R);
  }
  g.computeVertexNormals();
  const rest = pa.array.slice(), nrm = g.attributes.normal.array.slice();
  const dirt = new Float32Array(N), soap = new Float32Array(N), d0 = new Float32Array(N), live = new Uint8Array(N);
  const aDirt = new THREE.BufferAttribute(dirt, 1).setUsage(THREE.DynamicDrawUsage);
  const aSoap = new THREE.BufferAttribute(soap, 1).setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('aDirt', aDirt); g.setAttribute('aSoap', aSoap);

  // which vertices can be reached from the player's spot, and the starting grime
  const base = new THREE.Vector3(camPos.x, HALL_PLAT, cfg.z);
  let total0 = 0;
  for (let i = 0; i < N; i++) {
    const x = rest[i * 3], y = rest[i * 3 + 1], z = rest[i * 3 + 2];
    const nx = nrm[i * 3], ny = nrm[i * 3 + 1], nz = nrm[i * 3 + 2];
    const wx = base.x + x, wy = base.y - BOTTOM * R + y, wz = base.z + z;
    let cx = camPos.x - wx, cy = camPos.y - wy, cz = camPos.z - wz; const cl = Math.hypot(cx, cy, cz); cx /= cl; cy /= cl; cz /= cl;
    const reach = nx * cx + ny * cy + nz * cz > 0.08 && y / R > BOTTOM + 0.07;
    if (!reach) continue;
    live[i] = 1;
    const u = x / R, vv = y / R, w = z / R;
    let d = cfg.dirt * (0.7 + 0.6 * fbm(u * 1.6, vv * 1.6, w * 1.6, seed + 1));
    if (fbm(u * 1.2, vv * 1.2, w * 1.2, seed + 9) < 0.34) d *= 0.14;
    d += cfg.crust * sstep(0.52, 0.68, fbm(u * 2.4, vv * 2.4, w * 2.4, seed + 5));
    d0[i] = d; total0 += d;
  }

  const L = new THREE.Vector3(0.4, 0.8, 0.45).normalize();
  const mat = new THREE.ShaderMaterial({
    vertexShader: BODY_VS, fragmentShader: BODY_FS,
    uniforms: { uTime: { value: 0 }, uJig: { value: 0 }, uShine: { value: 0 }, uL: { value: L.clone() },
      uBase: { value: srgb(cfg.base) }, uShade: { value: srgb(cfg.shade) }, uDirtA: { value: srgb(0x6b5a44) }, uDirtB: { value: srgb(0x3b3026) } },
  });
  const omat = new THREE.ShaderMaterial({
    vertexShader: OUTLINE_VS, fragmentShader: 'void main(){ gl_FragColor = vec4(0.082, 0.078, 0.169, 1.0); }', side: THREE.BackSide,
    uniforms: { uTime: mat.uniforms.uTime, uJig: mat.uniforms.uJig, uWidth: { value: 1.6 }, uRes: { value: new THREE.Vector2(1280, 720) } },
  });

  const root = new THREE.Group();          // sits on the platform
  const squash = new THREE.Group(); root.add(squash);
  const body = new THREE.Mesh(g, mat); body.position.y = -BOTTOM * R * 1.0; squash.add(body);
  const hull = new THREE.Mesh(g, omat); body.add(hull);
  root.position.copy(base);

  // eyes
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const pupMat = new THREE.MeshBasicMaterial({ color: 0x1b1730, toneMapped: false });
  const lineMat = new THREE.MeshBasicMaterial({ color: 0x15142b, side: THREE.BackSide, toneMapped: false });
  const eyes = [];
  for (const sx of [-1, 1]) {
    const dir = new THREE.Vector3(sx * 0.34, 0.3, 0.89).normalize();
    const s = 1 / Math.hypot(dir.x / RAD[0], dir.y / RAD[1], dir.z / RAD[2]);
    const p = dir.clone().multiplyScalar(s * R * 1.0);
    const eg = new THREE.Group(); eg.position.copy(p); eg.lookAt(p.clone().multiply(new THREE.Vector3(1 / (RAD[0] * RAD[0]), 1 / (RAD[1] * RAD[1]), 1 / (RAD[2] * RAD[2]))).multiplyScalar(10));
    const re = 0.16 * R;
    const white = new THREE.Mesh(new THREE.SphereGeometry(re, 24, 16), eyeMat); white.scale.set(1, 1.18, 0.55);
    const line = new THREE.Mesh(new THREE.SphereGeometry(re * 1.09, 24, 16), lineMat); line.scale.set(1, 1.18, 0.58);
    const pup = new THREE.Mesh(new THREE.SphereGeometry(re * 0.52, 18, 12), pupMat); pup.scale.set(1, 1.15, 0.5);
    const glint = new THREE.Mesh(new THREE.SphereGeometry(re * 0.17, 10, 8), eyeMat);
    const lid = new THREE.Group(); lid.add(white, line, pup, glint); eg.add(lid);
    body.add(eg);
    eyes.push({ eg, lid, pup, glint, re });
  }

  // ---------------------------------------------------------------- state
  const M = {
    cfg, root, body, total: 0, total0, hpMax: cfg.hp, cleared: false, fading: false,
    jig: 0, squint: 0, blinkT: 2 + Math.random() * 3, happy: 0, soapSum: 0, dirtyDirty: false, soapDirty: false,
  };
  M.reset = () => {
    dirt.set(d0); soap.fill(0); M.total = total0; M.cleared = false; M.fading = false; M.happy = 0; M.soapSum = 0;
    aDirt.needsUpdate = true; aSoap.needsUpdate = true; mat.uniforms.uShine.value = 0;
  };
  M.frac = () => (total0 > 0 ? Math.max(0, M.total) / total0 : 0);
  M.hp = () => Math.ceil(M.frac() * M.hpMax);
  M.setRes = (res, width) => { omat.uniforms.uRes.value.copy(res); omat.uniforms.uWidth.value = width; };

  const inv = new THREE.Matrix4(), lo = new THREE.Vector3(), ld = new THREE.Vector3(), tmp = new THREE.Vector3();
  M.raycast = (origin, dirW) => {
    if (!root.visible) return null;
    body.updateWorldMatrix(true, false);
    inv.copy(body.matrixWorld).invert();
    lo.copy(origin).applyMatrix4(inv); ld.copy(dirW).transformDirection(inv);
    // transformDirection normalises; rescale t afterwards via world distance
    const rx = RAD[0] * R, ry = RAD[1] * R, rz = RAD[2] * R;
    const ox = lo.x / rx, oy = lo.y / ry, oz = lo.z / rz, dx = ld.x / rx, dy = ld.y / ry, dz = ld.z / rz;
    const a = dx * dx + dy * dy + dz * dz, b = 2 * (ox * dx + oy * dy + oz * dz), c = ox * ox + oy * oy + oz * oz - 1;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const t = (-b - Math.sqrt(disc)) / (2 * a);
    if (t < 0) return null;
    const pl = lo.clone().addScaledVector(ld, t);
    if (pl.y < BOTTOM * R) return null;
    const point = pl.clone().applyMatrix4(body.matrixWorld);
    const normal = new THREE.Vector3(pl.x / (rx * rx), pl.y / (ry * ry), pl.z / (rz * rz)).transformDirection(body.matrixWorld);
    return { point, normal, dist: point.distanceTo(origin) };
  };

  // spray footprint: ellipse (rx, ry) in the camera's screen plane around P
  M.clean = (P, right, up, fwd, fp, dt) => {
    if (M.cleared) return 0;
    body.updateWorldMatrix(true, false);
    const e = body.matrixWorld.elements;
    const sx = Math.hypot(e[0], e[1], e[2]), sz = Math.hypot(e[8], e[9], e[10]);
    let removed = 0, touched = false;
    const rx2 = 1 / (fp.rx * fp.rx), ry2 = 1 / (fp.ry * fp.ry), reach = Math.max(fp.rx, fp.ry);
    for (let i = 0; i < N; i++) {
      if (!live[i]) continue;
      const x = rest[i * 3], y = rest[i * 3 + 1], z = rest[i * 3 + 2];
      const wx = e[0] * x + e[4] * y + e[8] * z + e[12] - P.x;
      const wy = e[1] * x + e[5] * y + e[9] * z + e[13] - P.y;
      const wz = e[2] * x + e[6] * y + e[10] * z + e[14] - P.z;
      if (wx > reach || wx < -reach || wy > reach || wy < -reach || wz > reach + 0.3 || wz < -reach - 0.3) continue;
      const dx = wx * right.x + wy * right.y + wz * right.z, dy = wx * up.x + wy * up.y + wz * up.z, dz = wx * fwd.x + wy * fwd.y + wz * fwd.z;
      if (dz > 0.35) continue;
      const q = dx * dx * rx2 + dy * dy * ry2;
      if (q >= 1) continue;
      const nx = (e[0] * nrm[i * 3] + e[4] * nrm[i * 3 + 1] + e[8] * nrm[i * 3 + 2]) / sx;
      const ny = (e[1] * nrm[i * 3] + e[5] * nrm[i * 3 + 1] + e[9] * nrm[i * 3 + 2]);
      const nz = (e[2] * nrm[i * 3] + e[6] * nrm[i * 3 + 1] + e[10] * nrm[i * 3 + 2]) / sz;
      if (-(nx * fwd.x + ny * fwd.y + nz * fwd.z) < 0.02) continue;
      const f = 1 - q;
      if (fp.soapAdd) { const s0 = soap[i]; soap[i] = Math.min(1, s0 + fp.soapAdd * f * dt); M.soapSum += soap[i] - s0; touched = true; }
      if (dirt[i] > 0) {
        const nd = Math.max(0, dirt[i] - fp.str * f * (fp.soapAdd ? 1 : 1 + SOAP_BOOST * soap[i]) * dt);
        removed += dirt[i] - nd; dirt[i] = nd; touched = true;
      }
      if (fp.soapWash && soap[i] > 0) { const s0 = soap[i]; soap[i] = Math.max(0, s0 - fp.soapWash * f * dt); M.soapSum -= s0 - soap[i]; }
    }
    if (touched) { M.dirtyDirty = true; M.soapDirty = true; }
    M.total -= removed;
    if (removed > 0) { M.jig = Math.min(1, M.jig + removed * 0.25); M.squint = Math.min(1, M.squint + removed * 0.8); }
    return removed;
  };
  M._dbg = () => ({ N, live, dirt, rest, nrm, R });
  M.finishClean = () => { M.cleared = true; M.fading = true; M.happy = 1; };

  const camLocal = new THREE.Vector3();
  M.update = (dt, t, camWorld, viewMatrix) => {
    // idle life: slow sway + breathing squash
    root.rotation.y = 0.26 * Math.sin(t * 0.55 + seed);
    const b = Math.sin(t * 2.4 + seed) * (1 + M.happy * 2.5);
    const hop = M.happy > 0 ? Math.max(0, Math.sin(t * 7)) * 0.12 * R * M.happy : 0;
    squash.scale.set(1 + 0.012 * b, 1 - 0.022 * b, 1 + 0.012 * b);
    squash.position.y = hop;
    M.jig = Math.max(0, M.jig - dt * 2.5);
    M.squint = Math.max(0, M.squint - dt * 2.2);
    mat.uniforms.uTime.value = t; mat.uniforms.uJig.value = M.jig;
    mat.uniforms.uL.value.copy(L).transformDirection(viewMatrix);
    mat.uniforms.uShine.value = M.cleared ? 1 : 0;
    // soap slowly runs off on its own
    if (M.soapSum > 0.001) {
      const k = 0.012 * dt; let s = 0;
      for (let i = 0; i < N; i++) if (soap[i] > 0) { soap[i] = Math.max(0, soap[i] - k); s += soap[i]; }
      M.soapSum = s; M.soapDirty = true;
    }
    // remaining specks fade out once the zone is cleared
    if (M.fading) {
      let s = 0; const k = Math.exp(-dt * 5);
      for (let i = 0; i < N; i++) { if (dirt[i] > 0) { dirt[i] = dirt[i] * k - 0.002; if (dirt[i] < 0) dirt[i] = 0; s += dirt[i]; } }
      M.total = s; M.dirtyDirty = true; if (s <= 0) M.fading = false;
    }
    if (M.dirtyDirty) { aDirt.needsUpdate = true; M.dirtyDirty = false; }
    if (M.soapDirty) { aSoap.needsUpdate = true; M.soapDirty = false; }
    // eyes: look at the player, blink, squint when sprayed, happy arcs when clean
    M.blinkT -= dt;
    let open = 1;
    if (M.blinkT < 0) { open = 0.1; if (M.blinkT < -0.12) M.blinkT = 2.5 + Math.random() * 3; }
    open = Math.min(open, 1 - 0.65 * M.squint);
    if (M.happy) open = 0.28;
    for (const E of eyes) {
      E.lid.scale.y = THREE.MathUtils.lerp(E.lid.scale.y, open, 1 - Math.exp(-dt * 25));
      camLocal.copy(camWorld); E.eg.worldToLocal(camLocal); camLocal.normalize();
      E.pup.position.set(camLocal.x * E.re * 0.38, camLocal.y * E.re * 0.38, E.re * 0.36);
      E.glint.position.set(E.pup.position.x - E.re * 0.18, E.pup.position.y + E.re * 0.22, E.re * 0.5);
    }
  };
  M.reset();
  return M;
}
const HALL_PLAT = 0.08;

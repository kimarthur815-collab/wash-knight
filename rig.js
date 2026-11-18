// Wash Knight - first-person 3D rig (gauntlets + pressure washer), procedural three.js (r160)
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { TessellateModifier } from 'three/addons/modifiers/TessellateModifier.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const lerp = (a, b, t) => a + (b - a) * t;

export const HY = 0.033;                                   // housing axis height above grip top
export const NOZZLE_H = { red: 0.803, green: 0.802, soap: 0.796 };
export const LANCE_GRIP_Z = -0.340;

// ================================================================== geometry helpers
const v2 = (pts) => pts.map((p) => new THREE.Vector2(p[0], p[1]));
const spl = (pts, k = 4) => new THREE.SplineCurve(v2(pts)).getPoints((pts.length - 1) * k);

function lathe(pts, segs = 48, smooth = false) {
  return new THREE.LatheGeometry(smooth ? spl(pts) : v2(pts), segs);
}
// lathe along the housing axis: profile [r, h] with h = forward distance (-z)
function latheZ(pts, segs = 48, smooth = false) {
  const g = lathe(pts, segs, smooth);
  g.rotateX(-Math.PI / 2);
  g.translate(0, HY, 0);
  return g;
}
function faceted(g) {
  const h = g.index ? g.toNonIndexed() : g;
  h.deleteAttribute('normal');
  h.computeVertexNormals();
  return h;
}
function basis(yDir, zHint) {
  const y = yDir.clone().normalize();
  let x = new THREE.Vector3().crossVectors(y, zHint);
  if (x.lengthSq() < 1e-10) x = new THREE.Vector3().crossVectors(y, V(1, 0, 0));
  x.normalize();
  const z = new THREE.Vector3().crossVectors(x, y).normalize();
  return { x, y, z };
}
function M(origin, b, sx = 1, sy = 1, sz = 1) {
  return new THREE.Matrix4().makeBasis(b.x.clone().multiplyScalar(sx), b.y.clone().multiplyScalar(sy), b.z.clone().multiplyScalar(sz)).setPosition(origin);
}
// plate frame from outward normal N and length dir Vd (x = y cross z)
function plateFrame(origin, Vd, N) {
  const z = N.clone().normalize();
  const y = Vd.clone().sub(z.clone().multiplyScalar(Vd.dot(z))).normalize();
  const x = new THREE.Vector3().crossVectors(y, z).normalize();
  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(origin);
}

const tess = new TessellateModifier(0.0045, 8);
let LOD = 1;   // 1 = desktop, <1 = lighter (mobile)
function bendXYZ(x, y, z, R, R2) {
  let nx = x, nz = z;
  if (R) { const th = x / R; nx = (R + z) * Math.sin(th); nz = (R + z) * Math.cos(th) - R; }
  if (R2) nz -= (y * y) / (2 * R2);
  return V(nx, y, nz);
}
// thick plate from a 2D outline, bevelled, optionally embossed, then bent around an axis parallel to local y (R) and along y (R2)
function bentPlate(shapeOrPts, o = {}) {
  const { thick = 0.0024, bevel = 0.0011, R = 0.06, R2 = 0, edge = 0.0058, segs = 7, emboss = null } = o;
  const shape = shapeOrPts instanceof THREE.Shape ? shapeOrPts : new THREE.Shape(v2(shapeOrPts));
  let g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel,
    bevelSegments: 3, curveSegments: segs, steps: 1 });
  if (g.index) g = g.toNonIndexed();
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  tess.maxEdgeLength = edge / LOD;
  g = tess.modify(g);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    let z = p.getZ(i);
    if (emboss && z > thick * 0.5) z += emboss(x, y);
    const q = bendXYZ(x, y, z, R, R2);
    p.setXYZ(i, q.x, q.y, q.z);
  }
  g = mergeVertices(g, 1e-6);
  g.computeVertexNormals();
  return g;
}
function platePoint(frame, x, y, o = {}) {
  const { thick = 0.0024, bevel = 0.0011, R = 0.06, R2 = 0, emboss = null, lift = 0 } = o;
  const z = thick + bevel + (emboss ? emboss(x, y) : 0) + lift;
  return bendXYZ(x, y, z, R, R2).applyMatrix4(frame);
}
function roundedShape(pts, rad) {
  // polygon with rounded corners (quadratic)
  const s = new THREE.Shape();
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i], a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    const da = Math.hypot(a[0] - p[0], a[1] - p[1]), db = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const r = Math.min(rad, da / 2.2, db / 2.2);
    const p1 = [p[0] + (a[0] - p[0]) * r / da, p[1] + (a[1] - p[1]) * r / da];
    const p2 = [p[0] + (b[0] - p[0]) * r / db, p[1] + (b[1] - p[1]) * r / db];
    if (i === 0) s.moveTo(p1[0], p1[1]); else s.lineTo(p1[0], p1[1]);
    s.quadraticCurveTo(p[0], p[1], p2[0], p2[1]);
  }
  s.closePath();
  return s;
}
function tubeAlong(points, r, segs = 40, radial = 10, closed = false) {
  const c = new THREE.CatmullRomCurve3(points, closed, 'catmullrom', 0.5);
  return new THREE.TubeGeometry(c, segs, r, radial, closed);
}

// finger lame: closed lathe along +Y, length L, flared proximal lip
function lameGeo(L, r0, r1, tip = false) {
  const pts = tip ? [
    [0.0003, -0.13 * L], [r0 * 0.82, -0.11 * L], [r0 * 1.12, 0.0], [r0 * 1.08, 0.08 * L], [r0 * 1.0, 0.18 * L],
    [lerp(r0, r1, 0.6), 0.55 * L], [r1 * 0.95, 0.78 * L], [r1 * 0.76, 0.95 * L], [r1 * 0.38, 1.07 * L], [0.0003, 1.11 * L]
  ] : [
    [0.0003, -0.13 * L], [r0 * 0.82, -0.11 * L], [r0 * 1.12, 0.0], [r0 * 1.08, 0.08 * L], [r0 * 1.0, 0.18 * L],
    [lerp(r0, r1, 0.5), 0.5 * L], [r1, 0.84 * L], [r1 * 0.9, 0.98 * L], [r1 * 0.52, 1.07 * L], [0.0003, 1.1 * L]
  ];
  return lathe(pts, 30, true);
}

// ================================================================== builder
class Builder {
  constructor() { this.items = []; }
  add(geo, key, matrix) {
    const g = geo.clone();
    if (matrix) g.applyMatrix4(matrix);
    this.items.push({ g, key });
    return g;
  }
}
function normGeo(g) {
  const h = g.clone();
  for (const n of Object.keys(h.attributes)) if (!['position', 'normal', 'uv'].includes(n)) h.deleteAttribute(n);
  if (!h.attributes.normal) h.computeVertexNormals();
  if (!h.attributes.uv) h.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(h.attributes.position.count * 2), 2));
  if (!h.index) { const n = h.attributes.position.count, idx = new Uint32Array(n); for (let i = 0; i < n; i++) idx[i] = i; h.setIndex(new THREE.BufferAttribute(idx, 1)); }
  h.clearGroups();
  return h;
}
export function outlineGeo(g) {
  const p = new THREE.BufferGeometry();
  p.setAttribute('position', g.attributes.position.clone());
  if (g.index) p.setIndex(g.index.clone());
  const m = mergeVertices(p, 2e-5);
  m.computeVertexNormals();
  return m;
}

// ================================================================== GUN
const H_PROFILE = [
  [0.0004, -0.112], [0.0235, -0.112], [0.0262, -0.1112], [0.0285, -0.1095], [0.0302, -0.1065], [0.0315, -0.1025], [0.0322, -0.097],
  [0.0326, -0.090], [0.0327, -0.075], [0.0312, -0.0738], [0.0312, -0.0692], [0.0327, -0.068],
  [0.0330, -0.030], [0.0330, 0.030], [0.0328, 0.057], [0.0313, 0.0582], [0.0313, 0.0628], [0.0327, 0.064],
  [0.0322, 0.095], [0.0312, 0.112], [0.0296, 0.126], [0.0272, 0.138], [0.0238, 0.150], [0.0200, 0.160],
  [0.0172, 0.1665], [0.0160, 0.1700], [0.0158, 0.1725], [0.0004, 0.1725],
];
const band = (h0, h1, r = 0.0355, base = 0.0326) => [[base, h0], [r - 0.0009, h0 + 0.0008], [r, h0 + 0.0026], [r, h1 - 0.0026], [r - 0.0009, h1 - 0.0008], [base, h1]];

// grip edge lines (z as function of y)
const zf = (y) => -0.0235 + 0.027 * (0.012 - y) / 0.116;
const zb = (y) => 0.031 + 0.010 * (0.012 - y) / 0.120;
const zc = (y) => (zf(y) + zb(y)) / 2;

function gripGeo() {
  const s = new THREE.Shape();
  s.moveTo(-0.0235, 0.014);
  s.bezierCurveTo(-0.0205, -0.03, -0.0075, -0.07, 0.0028, -0.103);
  s.quadraticCurveTo(0.0078, -0.1175, 0.0225, -0.1185);
  s.quadraticCurveTo(0.0385, -0.1185, 0.0412, -0.1075);
  s.bezierCurveTo(0.0372, -0.07, 0.0315, -0.03, 0.0312, 0.014);
  s.lineTo(-0.0235, 0.014);
  const depth = 0.0205;
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.0068, bevelSize: 0.0062, bevelSegments: 4, curveSegments: 22 });
  g.translate(0, 0, -depth / 2);
  g.rotateY(-Math.PI / 2);
  return g;
}

function dialTexture() {
  const N = 512, c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  const cx = N / 2;
  const bgd = g.createRadialGradient(cx - 60, cx - 70, 30, cx, cx, cx);
  bgd.addColorStop(0, '#fffdf6'); bgd.addColorStop(0.75, '#f0ede3'); bgd.addColorStop(1, '#d4d0c4');
  g.fillStyle = bgd; g.fillRect(0, 0, N, N);
  const ang = (deg) => (deg - 90) * Math.PI / 180;           // 0deg = top, clockwise
  const arc = (a0, a1, col, r, w) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.arc(cx, cx, r, ang(a0), ang(a1)); g.stroke(); };
  arc(-130, 40, '#2fa866', 200, 30);
  arc(40, 92, '#f0b72a', 200, 30);
  arc(92, 130, '#e0443a', 200, 30);
  g.strokeStyle = '#26263a';
  for (let i = 0; i <= 26; i++) {
    const a = ang(-130 + i * 10), big = i % 2 === 0;
    g.lineWidth = big ? 7 : 4;
    const r0 = big ? 160 : 172, r1 = 222;
    g.beginPath(); g.moveTo(cx + Math.cos(a) * r0, cx + Math.sin(a) * r0); g.lineTo(cx + Math.cos(a) * r1, cx + Math.sin(a) * r1); g.stroke();
  }
  // drop logo
  g.fillStyle = '#3b7cf0';
  g.beginPath(); g.moveTo(cx, cx + 62); g.bezierCurveTo(cx - 26, cx + 100, cx - 30, cx + 122, cx, cx + 126);
  g.bezierCurveTo(cx + 30, cx + 122, cx + 26, cx + 100, cx, cx + 62); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.8)';
  g.beginPath(); g.ellipse(cx - 9, cx + 108, 5, 9, 0.3, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = 10; g.beginPath(); g.arc(cx, cx, 250, 0, Math.PI * 2); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function buildGun(B, dyn) {
  // housing + bands + nut + lance
  B.add(latheZ(H_PROFILE, 56), 'black');
  B.add(latheZ(band(-0.062, -0.040), 48), 'yellow');
  B.add(latheZ(band(0.030, 0.052), 48), 'yellow');
  B.add(faceted(latheZ([[0.0004, 0.1700], [0.0168, 0.1700], [0.0197, 0.1722], [0.0202, 0.1745], [0.0202, 0.1885], [0.0197, 0.1908],
    [0.0168, 0.1930], [0.0004, 0.1930]], 6)), 'yellow');
  B.add(latheZ([[0.0004, 0.1925], [0.0092, 0.1925], [0.0092, 0.195], [0.0089, 0.2], [0.0086, 0.735], [0.0089, 0.7395], [0.0004, 0.7395]], 28), 'black');
  B.add(latheZ([[0.0086, 0.212], [0.0104, 0.2124], [0.0112, 0.2142], [0.0112, 0.2298], [0.0104, 0.2316], [0.0086, 0.232]], 32), 'yellow');
  B.add(latheZ([[0.0085, 0.611], [0.0096, 0.6113], [0.0099, 0.6128], [0.0099, 0.6187], [0.0096, 0.6202], [0.0085, 0.6205]], 28), 'chrome');
  // quick coupler (knurled grooves)
  const cp = [[0.0004, 0.737], [0.0104, 0.737], [0.0114, 0.7388], [0.0116, 0.7415]];
  for (let k = 0; k < 4; k++) { const h = 0.7425 + k * 0.0052; cp.push([0.0116, h], [0.0108, h + 0.0011], [0.0108, h + 0.0027], [0.0116, h + 0.0038]); }
  cp.push([0.0116, 0.7642], [0.0109, 0.7660], [0.0004, 0.7660]);
  B.add(latheZ(cp, 32), 'chrome');

  // rear pressure knob (knurled)
  {
    const g = lathe([[0.0004, -0.1305], [0.0150, -0.1305], [0.0182, -0.1292], [0.0196, -0.1266], [0.0199, -0.1182], [0.0186, -0.1136],
      [0.0150, -0.1118], [0.0004, -0.1118]].map(([r, h]) => [r, h]), 72);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), r = Math.hypot(x, z);
      if (r > 0.0186) {
        const ph = Math.atan2(x, z), k = 1 + 0.055 * Math.pow(0.5 + 0.5 * Math.cos(ph * 28), 3);
        p.setX(i, x * k); p.setZ(i, z * k);
      }
    }
    g.computeVertexNormals();
    g.rotateX(-Math.PI / 2); g.translate(0, HY, 0);
    B.add(g, 'yellow');
    B.add(latheZ([[0.0004, -0.1312], [0.0085, -0.1312], [0.0092, -0.1305], [0.0004, -0.1300]], 32), 'dark');
  }
  // grip
  B.add(gripGeo(), 'black');
  // rubber side panels on grip (left & right)
  for (const sx of [-1, 1]) {
    const s = roundedShape([[-0.016, 0.0], [0.024, 0.0], [0.031, -0.085], [0.006, -0.088]], 0.006);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.0012, bevelEnabled: true, bevelThickness: 0.0006, bevelSize: 0.0008, bevelSegments: 2, curveSegments: 10 });
    g.rotateY(-Math.PI / 2);
    g.translate(sx * 0.0172 + (sx < 0 ? -0.0004 : 0.0016), -0.008, 0);
    if (sx > 0) g.scale(1, 1, 1);
    B.add(g, 'rubber');
    for (let k = 0; k < 8; k++) {
      const y = -0.012 - k * 0.0095, z0 = -0.012 + (0.012 - y) * 0.2, z1 = 0.026 + (0.012 - y) * 0.06;
      B.add(tubeAlong([V(sx * 0.0193, y, z0), V(sx * 0.0193, y - 0.0012, z1)], 0.00075, 6, 6), 'dark');
    }
  }
  // trigger slot + gauge stem
  B.add(new THREE.BoxGeometry(0.009, 0.004, 0.022), 'dark', new THREE.Matrix4().makeTranslation(0, 0.0005, -0.032));
  B.add(lathe([[0.0004, 0], [0.0052, 0], [0.0052, 0.024], [0.0068, 0.0255], [0.0068, 0.0285], [0.0004, 0.0285]], 24), 'black',
    new THREE.Matrix4().makeTranslation(0, 0.062, -0.072));

  // gauge (tilted toward camera)
  const gaugeM = new THREE.Matrix4().compose(V(0, 0.0985, -0.0725), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.72, 0, 0)), V(1, 1, 1));
  B.add(lathe([[0.0004, -0.0125], [0.0230, -0.0125], [0.0246, -0.0110], [0.0248, -0.002], [0.0004, -0.002]], 48), 'black', gaugeM);
  B.add(new THREE.TorusGeometry(0.0235, 0.0029, 12, 48).rotateX(Math.PI / 2).translate(0, 0.0004, 0), 'chrome', gaugeM);
  const gauge = new THREE.Group();
  gauge.name = 'gauge';
  gauge.matrixAutoUpdate = false; gauge.matrix.copy(gaugeM);
  const dial = new THREE.Mesh(new THREE.CircleGeometry(0.0216, 48).rotateX(-Math.PI / 2).translate(0, 0.0002, 0));
  dial.userData.key = 'dial';
  gauge.add(dial);
  const needle = new THREE.Group();
  needle.name = 'needle';
  const ns = new THREE.Shape();
  ns.moveTo(-0.0014, 0.0045); ns.lineTo(-0.0005, -0.0175); ns.lineTo(0, -0.0188); ns.lineTo(0.0005, -0.0175); ns.lineTo(0.0014, 0.0045);
  ns.quadraticCurveTo(0, 0.006, -0.0014, 0.0045);
  const ng = new THREE.ExtrudeGeometry(ns, { depth: 0.0007, bevelEnabled: false });
  ng.rotateX(Math.PI / 2); ng.translate(0, 0.0012, 0);
  const nm = new THREE.Mesh(ng); nm.userData.key = 'needle'; nm.userData.noOutline = true;
  needle.add(nm);
  const capm = new THREE.Mesh(new THREE.CylinderGeometry(0.0024, 0.0024, 0.0016, 20).translate(0, 0.0018, 0)); capm.userData.key = 'dark';
  needle.add(capm);
  gauge.add(needle);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.0381, 40, 8, 0, Math.PI * 2, 0, 0.6).translate(0, 0.0012 - 0.0381 * Math.cos(0.6), 0));
  dome.userData.key = 'glass'; dome.userData.noOutline = true; dome.renderOrder = 2;
  gauge.add(dome);
  const glare = new THREE.Shape();
  glare.absarc(0, 0, 0.0175, Math.PI * 0.62, Math.PI * 1.02, false);
  glare.absarc(0.003, -0.002, 0.0148, Math.PI * 1.0, Math.PI * 0.64, true);
  const gl = new THREE.Mesh(new THREE.ShapeGeometry(glare, 12).rotateX(-Math.PI / 2).translate(0, 0.0046, 0));
  gl.userData.key = 'glare'; gl.userData.noOutline = true; gl.renderOrder = 3;
  gauge.add(gl);
  dyn.gauge = gauge; dyn.needle = needle;

  // emblem (shield + drop) wrapped on the left side of the housing
  {
    const a = 0.16, R = 0.0334;
    const N = V(-Math.cos(a), -Math.sin(a), 0), T = V(-Math.sin(a), Math.cos(a), 0);
    const origin = V(N.x * R, HY + N.y * R, -0.010);
    const mtx = new THREE.Matrix4().makeBasis(T, new THREE.Vector3().crossVectors(N, T).normalize(), N).setPosition(origin);
    const shieldPts = (k) => {
      const s = new THREE.Shape();
      s.moveTo(0.0105 * k, -0.0105 * k); s.lineTo(0.0105 * k, 0.0105 * k); s.lineTo(-0.002 * k, 0.0105 * k);
      s.quadraticCurveTo(-0.010 * k, 0.007 * k, -0.0135 * k, 0);
      s.quadraticCurveTo(-0.010 * k, -0.007 * k, -0.002 * k, -0.0105 * k);
      s.lineTo(0.0105 * k, -0.0105 * k);
      return s;
    };
    B.add(bentPlate(shieldPts(1), { thick: 0.0007, bevel: 0.00045, R: R, edge: 0.002, segs: 10 }), 'yellow', mtx);
    B.add(bentPlate(shieldPts(0.74), { thick: 0.0007, bevel: 0.0003, R: R + 0.0011, edge: 0.002, segs: 10 }), 'dark',
      mtx.clone().multiply(new THREE.Matrix4().makeTranslation(0.0006, 0, 0.0011)));
    const drop = new THREE.Shape();
    drop.moveTo(0.0068, 0); drop.bezierCurveTo(0.0012, -0.0042, -0.0058, -0.004, -0.0058, 0);
    drop.bezierCurveTo(-0.0058, 0.004, 0.0012, 0.0042, 0.0068, 0);
    B.add(bentPlate(drop, { thick: 0.0006, bevel: 0.0003, R: R + 0.0022, edge: 0.0015, segs: 10 }), 'blue',
      mtx.clone().multiply(new THREE.Matrix4().makeTranslation(0.0004, 0, 0.0022)));
  }
  // screws
  for (const [z, a] of [[-0.085, 0.5], [0.085, 0.45], [-0.03, -0.9], [0.095, -0.85]]) {
    const N = V(-Math.cos(a), Math.sin(a), 0);
    const b = basis(N, V(0, 0, 1));
    const m = M(V(N.x * 0.0328, HY + N.y * 0.0328, z), b);
    B.add(lathe([[0.0004, 0], [0.0024, 0], [0.0026, 0.0006], [0.0021, 0.0011], [0.0004, 0.0012]], 16), 'chrome', m);
    B.add(new THREE.BoxGeometry(0.0034, 0.0008, 0.0006).translate(0, 0.0011, 0), 'dark', m);
  }
  // hose swivel + hose
  {
    const base = V(0, -0.1165, 0.0235), dir = V(0, -0.96, 0.28).normalize();
    const b = basis(dir, V(0, 0, 1));
    B.add(lathe([[0.0004, -0.003], [0.0100, -0.003], [0.0107, 0.0], [0.0107, 0.006], [0.0096, 0.0075], [0.0096, 0.0105],
      [0.0107, 0.012], [0.0107, 0.0175], [0.0100, 0.0195], [0.0004, 0.0195]], 6).toNonIndexed(), 'yellow', M(base, b));
    const start = base.clone().addScaledVector(dir, 0.019);
    const pts = [start, V(0.002, -0.170, 0.040), V(0.018, -0.24, 0.074), V(0.048, -0.32, 0.14), V(0.08, -0.40, 0.23), V(0.10, -0.48, 0.34)];
    const curve = new THREE.CatmullRomCurve3(pts);
    B.add(new THREE.TubeGeometry(curve, 70, 0.0096, 12), 'rubber');
    for (let t = 0.05; t < 0.98; t += 0.045) {
      const p = curve.getPointAt(t), tg = curve.getTangentAt(t);
      const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), tg);
      B.add(new THREE.TorusGeometry(0.0101, 0.0011, 5, 16), 'rubber', new THREE.Matrix4().compose(p, q, V(1, 1, 1)));
    }
  }
  // trigger (dynamic, pivot at top)
  {
    const piv = new THREE.Group();
    piv.name = 'trigger';
    piv.position.set(0, 0.0015, -0.031);
    const s = new THREE.Shape();
    s.moveTo(-0.0058, 0.0035); s.lineTo(0.0045, 0.0035);
    s.bezierCurveTo(0.0042, -0.02, 0.0002, -0.045, -0.0032, -0.066);
    s.quadraticCurveTo(-0.0058, -0.0722, -0.0112, -0.0695);
    s.bezierCurveTo(-0.0102, -0.045, -0.0068, -0.02, -0.0058, 0.0035);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.0068, bevelEnabled: true, bevelThickness: 0.0017, bevelSize: 0.0014, bevelSegments: 3, curveSegments: 20 });
    g.translate(0, 0, -0.0034); g.rotateY(-Math.PI / 2);
    const tm = new THREE.Mesh(g); tm.userData.key = 'yellow';
    piv.add(tm);
    // grip ridges on trigger face
    for (let k = 0; k < 4; k++) {
      const y = -0.03 - k * 0.0085, z = -0.0062 - k * 0.0012 + (y < -0.05 ? -0.001 : 0);
      const rg = new THREE.Mesh(tubeAlong([V(-0.0046, y, z), V(0.0046, y, z)], 0.0007, 4, 6)); rg.userData.key = 'yellowDark';
      piv.add(rg);
    }
    dyn.trigger = piv;
  }
  // safety lock tab
  B.add(new THREE.BoxGeometry(0.006, 0.006, 0.0075).translate(0, -0.003, -0.0215), 'dark');

  // nozzle tips (dynamic)
  const tips = {};
  const red = latheZ([[0.0004, 0.7655], [0.0105, 0.7655], [0.0109, 0.767], [0.0109, 0.782], [0.0101, 0.787], [0.0081, 0.795], [0.0061, 0.801], [0.0052, 0.803], [0.0004, 0.803]], 6);
  const redTip = faceted(red);
  tips.red = [[redTip, 'red']];
  tips.green = [[latheZ([[0.0004, 0.7655], [0.0105, 0.7655], [0.0109, 0.767], [0.0105, 0.779], [0.0113, 0.792], [0.0123, 0.8], [0.0121, 0.802], [0.0004, 0.802]], 32), 'green']];
  tips.soap = [[latheZ([[0.0004, 0.7655], [0.0113, 0.7655], [0.0119, 0.7675], [0.0119, 0.790], [0.0113, 0.7945], [0.0090, 0.796], [0.0004, 0.796]], 32), 'tipblack'],
    [latheZ(band(0.7745, 0.7845, 0.0126, 0.0118), 32), 'pink']];
  dyn.tipDefs = tips;
}

// ================================================================== HANDS
function lameBand(len, r, t = 0.0009, phiLen = 4.1, flare = 0.0008) {
  const pts = [[r - t, 0], [r + flare, 0.0002], [r + flare + 0.0002, 0.0009], [r + 0.0002, 0.0021], [r, 0.0034],
    [r, len - 0.0010], [r - 0.0003, len], [r - t, len - 0.0003], [r - t, 0]];
  return new THREE.LatheGeometry(v2(pts), 16, -phiLen / 2, phiLen);
}
function tipCap(L, r) {
  return lathe([[0.0003, 0], [r * 0.94, 0], [r * 1.06, 0.0011], [r * 1.07, 0.003], [r * 1.02, 0.35 * L], [r * 0.88, 0.7 * L],
    [r * 0.56, 0.93 * L], [0.0003, 1.03 * L]], 18, true);
}
// articulated gauntlet finger: leather glove core + overlapping dorsal lames + tip cap + joint caps
function finger(B, J, r, center, o = {}) {
  const { key = 'armor', target = null, lames = [3, 2, 1] } = o;
  const add = (g, k, m) => {
    if (target) { const mesh = new THREE.Mesh(m ? g.clone().applyMatrix4(m) : g); mesh.userData.key = k; target.add(mesh); }
    else B.add(g, k, m);
  };
  // leather glove core: straight capsules per phalanx (no spline overshoot at the joints)
  for (let i = 0; i < J.length - 1; i++) {
    const a = J[i], b = J[i + 1], d = b.clone().sub(a), L = d.length();
    const start = i === 0 ? a.clone().addScaledVector(d, -0.25) : a;
    const len = i === 0 ? L * 1.25 : (i === J.length - 2 ? Math.max(0.002, L - r * 1.2) : L);
    add(new THREE.CapsuleGeometry(r * 0.8, len, 3, 8).translate(0, len / 2, 0), 'leather', M(start, basis(d, V(0, 0, 1))));
  }
  let k = 0;
  for (let i = 0; i < J.length - 1; i++) {
    const a = J[i], b = J[i + 1], dir = b.clone().sub(a), L = dir.length();
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const bs = basis(dir, mid.clone().sub(center(mid)));
    const n = lames[i];
    const isTip = i === J.length - 2;
    const step = L / (isTip ? n + 0.75 : n);
    for (let j = 0; j < n; j++) {
      const len = step * 1.42, rr = r * (1.14 - 0.026 * k);
      add(lameBand(len, rr), key, M(a.clone().addScaledVector(bs.y, step * j - step * 0.2), bs, 1.03, 1, 0.94));
      k++;
    }
    if (isTip) {
      const st = step * n - step * 0.28;
      add(tipCap(L - st + r * 0.35, r * (1.13 - 0.026 * k)), key, M(a.clone().addScaledVector(bs.y, st), bs, 1.03, 1, 0.92));
    }
    if (i > 0) add(new THREE.SphereGeometry(r * 0.78, 14, 10), key, M(a.clone().addScaledVector(bs.z, r * 0.5), bs, 1.0, 0.72, 0.52));
  }
}
function knuckles(B, mcps, N, r) {
  const a = mcps[0], b = mcps[mcps.length - 1];
  const along = b.clone().sub(a), len = along.length();
  const c = a.clone().add(b).multiplyScalar(0.5);
  const w = r * 1.25, h = len / 2 + r * 1.15;
  const sh = roundedShape([[-w, -h], [w, -h], [w, h], [-w, h]], r * 0.95);
  const o = { thick: 0.0024, bevel: 0.0012, R: r * 1.35, R2: 0.3, edge: 0.0042 };
  B.add(bentPlate(sh, o), 'armor', plateFrame(c.clone().addScaledVector(N, r * 0.2), along, N));
  for (const p of mcps) {
    B.add(new THREE.SphereGeometry(r * 0.62, 14, 10), 'armor', M(p.clone().addScaledVector(N, r * 1.1), basis(N, along), 1.0, 0.42, 1.0));
  }
}
const ridgeEmboss = (w, h, y0, y1) => (x, y) => h * Math.exp(-(x * x) / (w * w)) * ss(y0, y0 + 0.008, y) * (1 - ss(y1 - 0.008, y1, y));

function arm(B, W, F, o) {
  // W: wrist centre, F: dir toward elbow. lathe along local +y.
  const { rim = 0.051, r0 = 0.0405, r1 = 0.047, len = 0.25, sleeveLen = 0.55, sleeveR = 0.076, flatZ = 0.84, side = 1 } = o;
  const b = basis(F, V(0, 1, 0));
  const m = M(W, b, 1, 1, flatZ);
  const prof = [[rim - 0.0048, 0.014], [rim - 0.0036, 0.003], [rim - 0.0012, -0.0015], [rim + 0.0012, 0.004], [rim - 0.001, 0.010], [rim - 0.0045, 0.020],
    [r0 + 0.002, 0.036], [r0, 0.052], [lerp(r0, r1, 0.35), 0.1], [lerp(r0, r1, 0.75), 0.18], [r1, len], [r1 - 0.0005, len + 0.004], [0.0004, len + 0.004]];
  {
    const g = lathe(prof, 48, true);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), r = Math.hypot(x, z);
      if (r < 0.01 || y < 0.004 || y > 0.034) continue;
      const amp = 0.045 * Math.sin(Math.PI * (y - 0.004) / 0.03), k = 1 + amp * Math.cos(Math.atan2(x, z) * 14);
      p.setX(i, x * k); p.setZ(i, z * k);
    }
    g.computeVertexNormals();
    B.add(g, 'armor', m);
  }
  // leather lining (profile reversed so it faces inward)
  B.add(lathe([[r0 - 0.0035, 0.07], [r0 - 0.0025, 0.035], [rim - 0.0062, 0.012], [rim - 0.0055, 0.003]], 36), 'leather', m);
  // rolled rims
  B.add(new THREE.TorusGeometry(rim + 0.0002, 0.0029, 10, 48).rotateX(Math.PI / 2).translate(0, 0.0015, 0), 'armor', m);
  B.add(lathe([[r1 - 0.002, len - 0.012], [r1 + 0.0022, len - 0.010], [r1 + 0.0032, len - 0.004], [r1 + 0.0032, len + 0.006], [r1 + 0.0018, len + 0.010], [r1 - 0.002, len + 0.011]], 48), 'armor', m);
  // etched rings near cuff
  for (const h of [0.060, 0.067]) {
    const rr = lerp(r0, r1, (h - 0.052) / (len - 0.052) * 0.6);
    B.add(new THREE.TorusGeometry(rr + 0.0004, 0.0009, 5, 48).rotateX(Math.PI / 2).translate(0, h, 0), 'armorDark', m);
  }
  // ridge along the top
  const rAt = (h) => (h < 0.052 ? r0 : lerp(r0, r1, (h - 0.052) / (len - 0.052)));
  const ridge = [];
  for (let h = 0.075; h <= len - 0.02; h += 0.02) ridge.push(V(0, h, rAt(h) + 0.0006));
  B.add(tubeAlong(ridge, 0.0021, 24, 8), 'armor', m);
  // rivets
  for (const a of [-1.1, -0.55, 0, 0.55, 1.1]) {
    const h = 0.045, rr = rAt(h) + 0.0002;
    B.add(new THREE.SphereGeometry(0.0022, 10, 8), 'armorDark', m.clone().multiply(new THREE.Matrix4().makeTranslation(Math.sin(a) * rr, h, Math.cos(a) * rr)));
  }
  // leather strap + buckle
  const hs = len * 0.66;
  B.add(lathe([[rAt(hs) - 0.001, hs], [rAt(hs) + 0.0016, hs + 0.0008], [rAt(hs) + 0.0019, hs + 0.003], [rAt(hs + 0.014) + 0.0019, hs + 0.011],
    [rAt(hs + 0.014) + 0.0016, hs + 0.0132], [rAt(hs + 0.014) - 0.001, hs + 0.014]], 48), 'leather', m);
  {
    const a = side * 0.55, rr = rAt(hs + 0.007) + 0.0028;
    const bm = m.clone().multiply(new THREE.Matrix4().makeTranslation(Math.sin(a) * rr, hs + 0.007, Math.cos(a) * rr))
      .multiply(new THREE.Matrix4().makeRotationY(a));
    const frame = new THREE.Shape();
    frame.moveTo(-0.0075, -0.0095); frame.lineTo(0.0075, -0.0095); frame.lineTo(0.0075, 0.0095); frame.lineTo(-0.0075, 0.0095); frame.lineTo(-0.0075, -0.0095);
    const hole = new THREE.Path(); hole.moveTo(-0.0048, -0.0068); hole.lineTo(-0.0048, 0.0068); hole.lineTo(0.0048, 0.0068); hole.lineTo(0.0048, -0.0068); hole.lineTo(-0.0048, -0.0068);
    frame.holes.push(hole);
    const fg = new THREE.ExtrudeGeometry(frame, { depth: 0.0012, bevelEnabled: true, bevelThickness: 0.0006, bevelSize: 0.0006, bevelSegments: 2 });
    fg.rotateX(Math.PI / 2); fg.rotateZ(Math.PI / 2);
    B.add(fg, 'chrome', bm);
    B.add(new THREE.CylinderGeometry(0.0008, 0.0008, 0.016, 8).rotateZ(Math.PI / 2), 'chrome', bm.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.0012, 0)));
  }
  // sleeve (cloth) with folds
  {
    const sp = [];
    const n = 14;
    for (let i = 0; i <= n; i++) { const t = i / n; sp.push([lerp(r1 - 0.002, sleeveR, Math.pow(t, 0.8)) + 0.004 * Math.sin(t * 9), len - 0.004 + t * sleeveLen]); }
    sp.unshift([0.0004, len - 0.004]); sp.push([0.0004, len - 0.004 + sleeveLen]);
    const g = lathe(sp, 40, false);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), r = Math.hypot(x, z);
      if (r < 0.01) continue;
      const ph = Math.atan2(x, z), t = (y - len) / sleeveLen;
      const k = 1 + Math.min(1, t * 6) * (0.055 * Math.sin(ph * 5 + t * 7) + 0.03 * Math.sin(ph * 11 - t * 13 + 1.3));
      p.setX(i, x * k); p.setZ(i, z * k);
    }
    g.computeVertexNormals();
    B.add(g, 'cloth', m);
    // bunched cuff edge under the armor rim
    B.add(new THREE.TorusGeometry(r1 + 0.001, 0.0035, 8, 48).rotateX(Math.PI / 2).translate(0, len + 0.013, 0), 'cloth', m);
  }
}

function buildRightHand(B, dyn) {
  const gripCenter = (p) => V(0, p.y, zc(p.y));
  const fingers = [[-0.0262, 0.0099, 1.0], [-0.0490, 0.0095, 1.0], [-0.0710, 0.0083, 0.88]];
  const mcps = [];
  for (const [y, r, s] of fingers) {
    const J = [V(0.0262, y + 0.003, zc(y) - 0.002), V(0.0142, y, zf(y) - 0.0115 * s), V(-0.0152, y - 0.0015, zf(y) - 0.0062 * s), V(-0.0228, y - 0.0025, zf(y) + 0.0185 * s)];
    finger(B, J, r, gripCenter);
    mcps.push(J[0]);
  }
  // index finger (dynamic, pivots at its knuckle)
  {
    const mcp = V(0.0255, -0.0045, zc(-0.0045) - 0.004);
    const piv = new THREE.Group();
    piv.name = 'index';
    piv.position.copy(mcp);
    const J = [V(0, 0, 0), V(0.0125, -0.010, -0.0395).sub(mcp), V(-0.0045, -0.0158, -0.0558).sub(mcp), V(-0.0088, -0.0198, -0.0448).sub(mcp)];
    const trigC = (p) => { const w = p.clone().add(mcp); return V(0, w.y, -0.039).sub(mcp); };
    finger(B, J, 0.0097, trigC, { target: piv });
    dyn.index = piv;
    mcps.unshift(mcp);
  }
  const NR = V(0.9, 0.05, 0.42).normalize();
  knuckles(B, mcps, NR, 0.0102);
  // thumb along the housing
  finger(B, [V(-0.004, -0.034, 0.054), V(-0.0268, 0.0045, 0.0375), V(-0.0385, 0.0215, -0.0015), V(-0.0395, 0.0278, -0.0385)],
    0.0112, (p) => V(0, HY, p.z), { lames: [2, 2, 1] });
  // palm (leather) wrapping the back strap
  B.add(new THREE.SphereGeometry(1, 32, 24), 'leather', new THREE.Matrix4().compose(V(0.009, -0.042, 0.047),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.18, 0, 0)), V(0.028, 0.055, 0.023)));
  // back-of-hand plates (outer side)
  {
    const mcpC = V(0.026, -0.037, 0.0), wrist = V(0.021, -0.064, 0.088);
    const o = { thick: 0.0026, bevel: 0.0013, R: 0.04, R2: 0.11, emboss: ridgeEmboss(0.006, 0.0018, -0.036, 0.046) };
    const sh = roundedShape([[-0.044, -0.036], [0.044, -0.036], [0.033, 0.046], [-0.031, 0.046]], 0.012);
    B.add(bentPlate(sh, o), 'armor', plateFrame(V(0.0405, -0.044, 0.035), wrist.clone().sub(mcpC), V(0.93, 0.06, 0.36).normalize()));
    const sh2 = roundedShape([[-0.034, -0.01], [0.034, -0.01], [0.031, 0.012], [-0.03, 0.012]], 0.008);
    B.add(bentPlate(sh2, { thick: 0.0024, bevel: 0.0012, R: 0.038 }), 'armor', plateFrame(V(0.0368, -0.062, 0.078), wrist.clone().sub(mcpC), V(0.9, -0.12, 0.42).normalize()));
  }
  // thenar plate (inner, under thumb base)
  {
    const sh = roundedShape([[-0.018, -0.024], [0.02, -0.024], [0.022, 0.022], [-0.016, 0.026]], 0.009);
    B.add(bentPlate(sh, { thick: 0.0024, bevel: 0.0012, R: 0.03, R2: 0.06 }), 'armor',
      plateFrame(V(-0.0205, -0.022, 0.050), V(0.1, -0.85, 0.5), V(-0.9, 0.15, 0.4).normalize()));
  }
  arm(B, V(0.021, -0.064, 0.088), V(0.26, -0.40, 0.88), { side: 1 });
}

function buildLeftHand(B) {
  const lanceC = (p) => V(0, HY, p.z);
  const fingers = [[-0.3625, 0.0092, 1.0], [-0.3415, 0.0096, 1.0], [-0.3212, 0.0092, 1.0], [-0.3030, 0.0081, 0.9]];
  const mcps = [];
  for (const [z, r, s] of fingers) {
    const J = [V(-0.0215, HY + 0.0105, z), V(-0.0015 * s, HY + 0.0205 * s, z - 0.0015), V(0.0165 * s, HY + 0.0108 * s, z - 0.0025), V(0.0182 * s, HY - 0.0068 * s, z - 0.0015)];
    finger(B, J, r, lanceC);
    mcps.push(J[0]);
  }
  const N = V(-0.86, 0.44, 0.26).normalize();
  knuckles(B, mcps, N, 0.0098);
  // thumb under the front of the lance
  finger(B, [V(-0.031, HY - 0.040, -0.348), V(-0.0222, HY - 0.0205, -0.3655), V(-0.0052, HY - 0.0152, -0.3755), V(0.0102, HY - 0.0118, -0.3722)],
    0.0106, lanceC, { lames: [2, 1, 1] });
  // palm
  B.add(new THREE.SphereGeometry(1, 28, 20), 'leather', new THREE.Matrix4().compose(V(-0.013, HY - 0.016, -0.333),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.5)), V(0.011, 0.02, 0.028)));
  // dorsal plate facing camera (up-left) with fluted ridge
  {
    const mcpC = V(-0.0215, HY + 0.0105, -0.333), wrist = V(-0.041, HY - 0.059, -0.311);
    const o = { thick: 0.0026, bevel: 0.0013, R: 0.03, R2: 0.07, emboss: ridgeEmboss(0.0055, 0.0024, -0.034, 0.04) };
    const sh = roundedShape([[-0.042, -0.034], [0.042, -0.034], [0.035, 0.042], [-0.034, 0.042]], 0.012);
    const F = plateFrame(V(-0.0365, HY - 0.0175, -0.3315), wrist.clone().sub(mcpC), N);
    B.add(bentPlate(sh, o), 'armor', F);
    for (const [x, y] of [[-0.03, -0.022], [0.03, -0.022], [-0.022, 0.03], [0.022, 0.03]]) {
      B.add(new THREE.SphereGeometry(0.0019, 10, 8), 'armorDark', new THREE.Matrix4().makeTranslation(...platePoint(F, x, y, o).toArray()));
    }
    const sh2 = roundedShape([[-0.036, -0.010], [0.036, -0.010], [0.033, 0.012], [-0.032, 0.012]], 0.007);
    B.add(bentPlate(sh2, { thick: 0.0024, bevel: 0.0012, R: 0.034 }), 'armor',
      plateFrame(V(-0.0425, HY - 0.0505, -0.315), wrist.clone().sub(mcpC), N.clone().add(V(0, -0.15, 0.05)).normalize()));
  }
  arm(B, V(-0.042, HY - 0.061, -0.3085), V(-0.80, -0.42, 0.43), { side: -1, rim: 0.046, r0: 0.038, r1: 0.045 });
}

// ================================================================== looks (materials)
const ss = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const hex = (c) => { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function paintMatcap(cols, kind, P = {}) {
  const N = 256, c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d'), im = g.createImageData(N, N), d = im.data;
  const L = V(...(P.L || [-0.52, 0.6, 0.6])).normalize();
  const H = L.clone().add(V(0, 0, 1)).normalize();
  const C = {};
  for (const k in cols) C[k] = hex(cols[k]);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    let x = (i + 0.5) / N * 2 - 1, y = 1 - (j + 0.5) / N * 2;
    const r2 = x * x + y * y;
    let z = 0;
    if (r2 >= 1) { const s = 1 / Math.sqrt(r2); x *= s; y *= s; } else z = Math.sqrt(1 - r2);
    const diff = x * L.x + y * L.y + z * L.z;
    const nh = Math.max(0, x * H.x + y * H.y + z * H.z);
    let col;
    if (kind === 'metal') {
      col = C.deep;
      col = mix3(col, C.shadow, ss(-0.55, -0.47, diff));
      col = mix3(col, C.mid, ss(-0.06, 0.0, diff));
      col = mix3(col, C.base, ss(0.27, 0.33, diff));
      col = mix3(col, C.light, ss(0.60, 0.66, diff));
      const hb = ss(-0.25, -0.21, y) * (1 - ss(-0.08, -0.04, y)) * (1 - ss(0.6, 0.7, diff));
      col = mix3(col, C.band, hb * (P.band ?? 0.85));
      col = mix3(col, C.refl, (1 - ss(-0.72, -0.6, y)) * ss(0.0, 0.3, z) * (P.refl ?? 0.9));
      col = mix3(col, C.deep, (1 - ss(0.08, 0.26, z)) * (P.rim ?? 0.35));
      const sp = Math.pow(nh, P.shin ?? 70);
      col = mix3(col, C.spec, ss(0.5, 0.6, sp));
      col = mix3(col, C.spec, ss(0.1, 0.8, sp) * 0.25);
    } else if (kind === 'gloss') {
      col = C.shadow;
      col = mix3(col, C.base, ss(-0.15, -0.08, diff));
      col = mix3(col, C.light, ss(0.45, 0.52, diff));
      col = mix3(col, C.refl, (1 - ss(-0.7, -0.58, y)) * ss(0.0, 0.3, z) * (P.refl ?? 0.8));
      col = mix3(col, C.shadow, (1 - ss(0.08, 0.3, z)) * (P.rim ?? 0.4));
      const sp = Math.pow(nh, P.shin ?? 90);
      col = mix3(col, C.spec, ss(0.42, 0.52, sp));
      col = mix3(col, C.spec, ss(0.05, 0.6, sp) * (P.glow ?? 0.18));
    } else if (kind === 'cloth') {
      col = C.shadow;
      col = mix3(col, C.base, ss(-0.2, 0.0, diff));
      col = mix3(col, C.light, ss(0.42, 0.62, diff));
      col = mix3(col, C.sheen, (1 - ss(0.12, 0.5, z)) * 0.55);
    } else { // soft (leather, rubber, foam)
      col = C.shadow;
      col = mix3(col, C.base, ss(-0.3, 0.05, diff));
      col = mix3(col, C.light, ss(0.4, 0.7, diff));
      const sp = Math.pow(nh, P.shin ?? 24);
      col = mix3(col, C.spec, ss(0.4, 0.8, sp) * (P.specK ?? 0.5));
      col = mix3(col, C.shadow, (1 - ss(0.1, 0.35, z)) * (P.rim ?? 0.3));
    }
    const k = (j * N + i) * 4;
    d[k] = col[0]; d[k + 1] = col[1]; d[k + 2] = col[2]; d[k + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const TOON = {
  armor: ['metal', { deep: '#636a96', shadow: '#8c92bc', mid: '#aeb3d6', base: '#d2d6ed', light: '#eef0fa', band: '#9aa0c7', refl: '#c3cdf5', spec: '#ffffff' }],
  armorDark: ['metal', { deep: '#4d5380', shadow: '#6e749f', mid: '#8b91bb', base: '#a9aed0', light: '#c9cde6', band: '#7d84ae', refl: '#a9b4e6', spec: '#ffffff' }, { rim: 0.3 }],
  chrome: ['metal', { deep: '#3e4466', shadow: '#5d6390', mid: '#8a90b8', base: '#d9dcef', light: '#f6f7fd', band: '#4b5180', refl: '#b8c2ee', spec: '#ffffff' }, { band: 1, shin: 120 }],
  black: ['gloss', { shadow: '#14141c', base: '#23242f', light: '#3a3c52', refl: '#30385e', spec: '#e6e9ff' }, { shin: 60, glow: 0.22 }],
  dark: ['soft', { shadow: '#0b0b10', base: '#16161e', light: '#262735', spec: '#5a5e7c' }],
  rubber: ['soft', { shadow: '#101015', base: '#1d1e27', light: '#2f3142', spec: '#7d82a3' }, { shin: 18, specK: 0.35 }],
  yellow: ['gloss', { shadow: '#b8770a', base: '#eaae22', light: '#ffd04f', refl: '#e7a52a', spec: '#fffbea' }, { shin: 80 }],
  yellowDark: ['gloss', { shadow: '#8e5a06', base: '#c58a12', light: '#e0a524', refl: '#c48a1e', spec: '#ffe9a3' }],
  red: ['gloss', { shadow: '#8f1d19', base: '#d63b32', light: '#f26457', refl: '#c4352f', spec: '#ffe4e0' }],
  green: ['gloss', { shadow: '#166a3b', base: '#2aa660', light: '#48cc80', refl: '#279458', spec: '#eafff3' }],
  tipblack: ['gloss', { shadow: '#16161f', base: '#2b2c3b', light: '#44475f', refl: '#363c5c', spec: '#f0f2ff' }],
  pink: ['gloss', { shadow: '#a24cb2', base: '#d982ea', light: '#f3b6ff', refl: '#c96ee0', spec: '#ffffff' }],
  blue: ['gloss', { shadow: '#1d4fb8', base: '#3b7cf0', light: '#8fc0ff', refl: '#3a6fe0', spec: '#ffffff' }],
  cloth: ['cloth', { shadow: '#18267f', base: '#2c49cf', light: '#4c6bee', sheen: '#7d97ff' }],
  leather: ['soft', { shadow: '#1e1615', base: '#3d302d', light: '#5e4c47', spec: '#9a8379' }, { shin: 20, specK: 0.4 }],
  foam: ['soft', { shadow: '#cdb8e2', base: '#f1e8fa', light: '#ffffff', spec: '#ffffff' }, { rim: 0.15 }],
};
const REAL = {
  armor: { color: 0xdfe2f2, metalness: 0.92, roughness: 0.22, clearcoat: 0.4, clearcoatRoughness: 0.15 },
  armorDark: { color: 0xa6abcc, metalness: 0.9, roughness: 0.3 },
  chrome: { color: 0xf0f2f8, metalness: 1.0, roughness: 0.1 },
  black: { color: 0x1d1e28, metalness: 0.05, roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.2 },
  dark: { color: 0x0f0f14, metalness: 0.0, roughness: 0.7 },
  rubber: { color: 0x1a1b23, metalness: 0.0, roughness: 0.62 },
  yellow: { color: 0xf3b52a, metalness: 0.0, roughness: 0.28, clearcoat: 0.9, clearcoatRoughness: 0.12 },
  yellowDark: { color: 0xc58a12, metalness: 0.0, roughness: 0.4 },
  red: { color: 0xd63b32, roughness: 0.3, clearcoat: 0.8 },
  green: { color: 0x2aa660, roughness: 0.3, clearcoat: 0.8 },
  tipblack: { color: 0x26272f, roughness: 0.35, clearcoat: 0.6 },
  pink: { color: 0xe08af0, roughness: 0.35, clearcoat: 0.6 },
  blue: { color: 0x3b7cf0, roughness: 0.3, clearcoat: 0.7 },
  cloth: { color: 0x2747d4, roughness: 0.82, sheen: 1, sheenColor: 0x9bb0ff, sheenRoughness: 0.5 },
  leather: { color: 0x3a2d2a, roughness: 0.6, clearcoat: 0.25, clearcoatRoughness: 0.5 },
  foam: { color: 0xf6eefc, roughness: 0.6 },
};

export function makeLooks() {
  const toon = {}, real = {};
  for (const [k, [kind, cols, P]] of Object.entries(TOON)) {
    toon[k] = new THREE.MeshMatcapMaterial({ matcap: paintMatcap(cols, kind, P || {}) });
    toon[k].toneMapped = false;
  }
  for (const [k, o] of Object.entries(REAL)) {
    real[k] = new THREE.MeshPhysicalMaterial(o);
  }
  const dialTex = dialTexture();
  const shared = {
    dial: new THREE.MeshBasicMaterial({ map: dialTex, toneMapped: false }),
    needle: new THREE.MeshBasicMaterial({ color: 0xe2352d, toneMapped: false }),
    glass: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.10, depthWrite: false, toneMapped: false }),
    glare: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }),
  };
  Object.assign(toon, shared); Object.assign(real, shared);
  return { toon, real };
}

export function makeOutlineMaterial(color = 0x15142b, width = 1.6) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uWidth: { value: width }, uRes: { value: new THREE.Vector2(1280, 720) } },
    vertexShader: /* glsl */`
      uniform float uWidth; uniform vec2 uRes;
      void main() {
        vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        vec3 n = normalize(normalMatrix * normal);
        vec2 dir = (projectionMatrix * vec4(n, 0.0)).xy;
        float l = length(dir);
        dir = l > 1e-6 ? dir / l : vec2(0.0);
        clip.xy += dir * uWidth * 2.0 / uRes * clip.w;
        gl_Position = clip;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor;
      void main() { gl_FragColor = vec4(uColor, 1.0); }`,
    side: THREE.BackSide,
  });
}

// ================================================================== build
export function buildRig(opts = {}) {
  LOD = opts.lod ?? 1;
  const B = new Builder();
  const dyn = {};
  buildGun(B, dyn);
  buildRightHand(B, dyn);
  buildLeftHand(B);

  const root = new THREE.Group();
  root.name = 'WashKnightFP';
  const looks = makeLooks();
  const outlineMat = makeOutlineMaterial();
  const meshes = [];   // {mesh, key}
  const outlines = [];

  // bake static geometry per material
  const groups = {};
  for (const it of B.items) (groups[it.key] ||= []).push(normGeo(it.g));
  for (const [key, list] of Object.entries(groups)) {
    const g = mergeGeometries(list, false);
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, looks.toon[key]);
    mesh.name = 'static_' + key;
    mesh.userData.key = key;
    root.add(mesh);
    meshes.push(mesh);
    const o = new THREE.Mesh(outlineGeo(g), outlineMat);
    o.name = 'outline_' + key;
    root.add(o);
    outlines.push(o);
  }
  // dynamic parts
  const attach = (obj) => {
    obj.traverse((m) => {
      if (!m.isMesh || !m.userData.key) return;
      m.material = looks.toon[m.userData.key];
      meshes.push(m);
      if (!m.userData.noOutline) {
        const o = new THREE.Mesh(outlineGeo(normGeo(m.geometry)), outlineMat);
        m.add(o);
        outlines.push(o);
      }
    });
  };
  root.add(dyn.gauge); attach(dyn.gauge);
  root.add(dyn.trigger); attach(dyn.trigger);
  root.add(dyn.index); attach(dyn.index);
  // nozzle tips
  const tips = {};
  const tipGroup = new THREE.Group();
  tipGroup.name = 'tips';
  const tipPivot = V(0, HY, -0.7655);
  tipGroup.position.copy(tipPivot);
  for (const [name, parts] of Object.entries(dyn.tipDefs)) {
    const grp = new THREE.Group();
    for (const [g, key] of parts) {
      const m = new THREE.Mesh(g.clone().translate(-tipPivot.x, -tipPivot.y, -tipPivot.z));
      m.userData.key = key;
      grp.add(m);
    }
    grp.visible = name === 'red';
    tips[name] = grp;
    tipGroup.add(grp);
  }
  root.add(tipGroup);
  attach(tipGroup);

  function setLook(mode) {
    const set = mode === 'real' ? looks.real : looks.toon;
    for (const m of meshes) m.material = set[m.userData.key];
    for (const o of outlines) o.visible = mode !== 'real';
  }
  return {
    root, looks, outlineMat, setLook,
    trigger: dyn.trigger, index: dyn.index, needle: dyn.needle, gauge: dyn.gauge,
    tips, tipGroup,
    nozzleLocal: (tool) => V(0, HY, -NOZZLE_H[tool]),
    stats: () => { let t = 0; root.traverse((m) => { if (m.isMesh) t += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3; }); return t; },
  };
}

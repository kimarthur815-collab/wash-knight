// Wash Knight - wash hall map: three wash bays side by side (구역 1~3) along one corridor
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const HALL = { bayW: 4.8, n: 3, h: 3.3, back: -4.2, front: 1.6, partZ: -0.9, partT: 0.14, camY: 1.55, camZ: 0.6, monZ: -2.0, platH: 0.08 };
HALL.w = HALL.bayW * HALL.n / 2;
export const bayX = (i) => (i - (HALL.n - 1) / 2) * HALL.bayW;

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function tileTexture(cols, n, opts = {}) {
  const S = 1024, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = opts.grout || '#22343c'; g.fillRect(0, 0, S, S);
  const T = S / n; let seed = opts.seed || 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const col = cols[Math.floor(rnd() * cols.length)];
    const gx = x * T + 5, gy = y * T + 5, w = T - 10;
    const gr = g.createLinearGradient(gx, gy, gx + w, gy + w);
    gr.addColorStop(0, col[0]); gr.addColorStop(1, col[1]);
    g.fillStyle = gr; g.beginPath(); g.roundRect(gx, gy, w, w, T * 0.06); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.10)'; g.beginPath(); g.ellipse(gx + w * 0.28, gy + w * 0.22, w * 0.18, w * 0.06, -0.5, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 3; g.beginPath(); g.moveTo(gx + w * 0.1, gy + 4); g.lineTo(gx + w * 0.85, gy + 4); g.stroke();
  }
  if (opts.grime) {
    for (let i = 0; i < 26; i++) {
      const x = rnd() * S, y = rnd() * S, r = 40 + rnd() * 160;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(${80 + rnd() * 30},${66 + rnd() * 20},40,${0.14 + rnd() * 0.12})`); gr.addColorStop(1, 'rgba(80,66,40,0)');
      g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}
function plane(w, h, mat, rep) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat.clone());
  if (rep) { m.material.map = mat.map.clone(); m.material.map.needsUpdate = true; m.material.map.repeat.set(rep[0], rep[1]); }
  return m;
}
function canvasTex(W, H) {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return { c, g: c.getContext('2d'), t };
}

export function buildWorld(world) {
  const { w, h, back, front, bayW, partZ, partT, platH, monZ } = HALL, depth = front - back;
  world.background = new THREE.Color(0x17222a);
  world.fog = new THREE.Fog(0x17222a, 10, 24);
  world.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2430, 1.1));
  const sun = new THREE.DirectionalLight(0xffe2bf, 1.7); sun.position.set(-3, 5, 3); world.add(sun);

  const wallTex = tileTexture([['#5d8792', '#456c77'], ['#56808b', '#3f6570'], ['#62909b', '#4a737e'], ['#5a8590', '#43697a']], 6, { grime: true });
  const bandTex = tileTexture([['#2c4ea8', '#1f3a86'], ['#2a4aa0', '#1c357c']], 6, { grout: '#14203c' });
  const floorTex = tileTexture([['#3b4a52', '#2c3940'], ['#36454d', '#28343b'], ['#404f57', '#2f3c43']], 4, { grout: '#141b20', grime: true });
  const wallMat = new THREE.MeshLambertMaterial({ map: wallTex });
  const bandMat = new THREE.MeshLambertMaterial({ map: bandTex });
  const surfaces = [];
  const wall = (W, H, pos, rotY, band = true) => {
    const m = plane(W, H, wallMat, [W / 1.5, H / 1.5]); m.rotation.y = rotY; m.position.copy(pos); world.add(m); surfaces.push(m);
    if (band) { const b = plane(W, 0.5, bandMat, [W / 1.5, 0.5 / 1.5]); b.rotation.y = rotY; b.position.copy(pos).setY(1.05); b.translateZ(0.002); world.add(b); }
    return m;
  };
  // outer walls
  wall(w * 2, h, V(0, h / 2, back), 0);
  wall(w * 2, h, V(0, h / 2, front), Math.PI);
  wall(depth, h, V(-w, h / 2, (back + front) / 2), Math.PI / 2);
  wall(depth, h, V(w, h / 2, (back + front) / 2), -Math.PI / 2);
  // partitions between bays (open toward the corridor)
  const pd = partZ - back;
  for (const px of [-bayW / 2, bayW / 2]) {
    wall(pd, h, V(px - partT / 2, h / 2, back + pd / 2), -Math.PI / 2);
    wall(pd, h, V(px + partT / 2, h / 2, back + pd / 2), Math.PI / 2);
    wall(partT, h, V(px, h / 2, partZ), 0);
  }
  // floor
  const floor = plane(w * 2, depth, new THREE.MeshLambertMaterial({ map: floorTex }), [w * 2 / 1.2, depth / 1.2]);
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, (back + front) / 2); world.add(floor); surfaces.push(floor);
  // ceiling panels with baked lamp glow
  const LAMPS = [];
  for (let i = 0; i < HALL.n; i++) for (const [dx, z] of [[-1.5, -2.9], [1.5, -2.9], [-1.5, -0.5], [1.5, -0.5]]) LAMPS.push([bayX(i) + dx, z]);
  {
    const W = 2048, H = Math.round(2048 * depth / (w * 2)), { g, t } = canvasTex(W, H), px = W / (w * 2), P = 0.6 * px;
    g.fillStyle = '#1a2328'; g.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y += P) for (let x = 0; x < W; x += P) {
      const gr = g.createLinearGradient(x, y, x + P, y + P); gr.addColorStop(0, '#46565e'); gr.addColorStop(1, '#38464d');
      g.fillStyle = gr; g.fillRect(x + 2, y + 2, P - 4, P - 4);
    }
    for (const [lx, lz] of LAMPS) {
      const u = (lx + w) * px, v = (1 - (lz - back) / depth) * H, RR = 1.6 * px;
      const gr = g.createRadialGradient(u, v, 0, u, v, RR);
      gr.addColorStop(0, 'rgba(255,238,205,0.75)'); gr.addColorStop(0.22, 'rgba(255,232,195,0.32)'); gr.addColorStop(1, 'rgba(255,230,190,0)');
      g.fillStyle = gr; g.fillRect(u - RR, v - RR, 2 * RR, 2 * RR);
    }
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(w * 2, depth), new THREE.MeshBasicMaterial({ map: t }));
    ceil.rotation.x = Math.PI / 2; ceil.position.set(0, h, (back + front) / 2); ceil.userData.wetOff = 0.0025;
    world.add(ceil); surfaces.push(ceil);
  }
  {
    const lamps = [], frames = [];
    for (const [x, z] of LAMPS) {
      lamps.push(new THREE.PlaneGeometry(0.46, 0.46).rotateX(Math.PI / 2).translate(x, h - 0.006, z));
      frames.push(new THREE.PlaneGeometry(0.56, 0.56).rotateX(Math.PI / 2).translate(x, h - 0.004, z));
    }
    world.add(new THREE.Mesh(mergeGeometries(lamps), new THREE.MeshBasicMaterial({ color: 0xfff3dc, toneMapped: false })));
    world.add(new THREE.Mesh(mergeGeometries(frames), new THREE.MeshBasicMaterial({ color: 0x8b979e })));
  }
  // per-bay wash platform + drain
  const drainTex = (() => {
    const { g, t } = canvasTex(256, 256);
    g.fillStyle = '#0d1215'; g.beginPath(); g.arc(128, 128, 126, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#55636b'; for (let i = -3; i <= 3; i++) g.fillRect(40, 124 + i * 26, 176, 9);
    return t;
  })();
  const platMat = new THREE.MeshLambertMaterial({ color: 0x3a464d }), rimMat = new THREE.MeshLambertMaterial({ color: 0xf2b72c });
  for (let i = 0; i < HALL.n; i++) {
    const x = bayX(i);
    const plat = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.32, platH, 48), platMat); plat.position.set(x, platH / 2, monZ); world.add(plat);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.29, 0.03, 8, 64), rimMat); rim.rotation.x = Math.PI / 2; rim.position.set(x, platH, monZ); world.add(rim);
    const drain = new THREE.Mesh(new THREE.CircleGeometry(0.22, 32), new THREE.MeshBasicMaterial({ map: drainTex, transparent: true }));
    drain.rotation.x = -Math.PI / 2; drain.position.set(x + 1.15, 0.003, monZ + 1.55); world.add(drain);
  }
  // signs: shop sign over bay 1, zone plates in every bay
  const redraw = [];
  {
    const { c, g, t } = canvasTex(1024, 256);
    const draw = () => {
      g.clearRect(0, 0, 1024, 256);
      g.fillStyle = '#1c2340'; g.beginPath(); g.roundRect(8, 8, 1008, 240, 40); g.fill();
      g.lineWidth = 10; g.strokeStyle = '#f2b72c'; g.stroke();
      g.fillStyle = '#ffd257'; g.font = '700 40px "Noto Sans KR", sans-serif'; g.textAlign = 'center'; g.fillText('WASH KNIGHT · 몬스터 전용 워시샵', 512, 82);
      g.fillStyle = '#ffffff'; g.font = '400 112px "Black Han Sans", sans-serif'; g.fillText('워시 나이트', 512, 206);
      t.needsUpdate = true;
    };
    redraw.push(draw);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6), new THREE.MeshBasicMaterial({ map: t, transparent: true }));
    sign.position.set(bayX(0), 2.62, back + 0.01); world.add(sign);
  }
  for (let i = 0; i < HALL.n; i++) {
    const { g, t } = canvasTex(512, 256);
    const draw = () => {
      g.clearRect(0, 0, 512, 256);
      g.fillStyle = '#f2b72c'; g.beginPath(); g.roundRect(6, 6, 500, 244, 34); g.fill();
      g.fillStyle = '#1c2340'; g.beginPath(); g.roundRect(18, 18, 476, 220, 26); g.fill();
      g.fillStyle = '#ffd257'; g.font = '700 46px "Noto Sans KR", sans-serif'; g.textAlign = 'center'; g.fillText('ZONE', 256, 92);
      g.fillStyle = '#ffffff'; g.font = '400 112px "Black Han Sans", sans-serif'; g.fillText(`구역 ${i + 1}`, 256, 208);
      t.needsUpdate = true;
    };
    redraw.push(draw);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.4), new THREE.MeshBasicMaterial({ map: t, transparent: true }));
    plate.position.set(bayX(i) + 1.6, 2.62, back + 0.01); world.add(plate);
  }
  redraw.forEach((f) => f());
  if (document.fonts) document.fonts.ready.then(() => redraw.forEach((f) => f()));
  // shelf with soap bottles on the left end wall (bay 1)
  const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.04, 1.2), new THREE.MeshLambertMaterial({ color: 0x6b4b34 }));
  shelf.position.set(-w + 0.14, 1.35, back + 1.5); world.add(shelf);
  const bc = [0xe889f2, 0x3fb36b, 0xf2b72c, 0x5fa8ff];
  for (let i = 0; i < 5; i++) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.26 + (i % 2) * 0.06, 16), new THREE.MeshLambertMaterial({ color: bc[i % 4] }));
    b.position.set(-w + 0.14, 1.5 + (i % 2) * 0.03, back + 1.05 + i * 0.2); world.add(b);
  }
  world.updateMatrixWorld(true);   // static geometry: keep raycasts valid before the first render
  return { surfaces, bounds: { w, h, back, front } };
}

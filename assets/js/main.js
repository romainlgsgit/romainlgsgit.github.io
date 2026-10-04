import * as THREE from 'three';

/* ==========================================================
   Outils
   ========================================================== */
const D = Math.PI / 180;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const range = (p, a, b) => clamp((p - a) / (b - a));
const smooth = (t) => t * t * (3 - 2 * t);
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const rand = (a = 0, b = 1) => a + Math.random() * (b - a);

const journey = document.getElementById('journey');
const overlay = document.getElementById('overlay');
const canvas = document.getElementById('scene');
const clouds = document.getElementById('clouds');
const topbar = document.querySelector('.topbar');
const hud = document.querySelector('.hud');
const altEl = document.getElementById('alt');
const stageEls = [...document.querySelectorAll('#stages li')];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* Phases du voyage (progression 0 → 1 sur #journey) */
const SWITCH = 0.5; // passage Terre → stade (caché par les nuages)

/* ==========================================================
   Scroll & calques HTML
   ========================================================== */
let target = 0;
let prog = 0;
let journeyEnd = 1;

function measure() {
  journeyEnd = Math.max(1, journey.offsetHeight - innerHeight);
}
let frozen = false; // aperçu figé via ?p=
function readScroll() {
  if (!frozen) target = clamp(scrollY / journeyEnd);
}

const fades = [...document.querySelectorAll('[data-show]')].map((el) => ({
  el,
  k: el.dataset.show.split(',').map(Number),
}));

function updateOverlays(p) {
  for (const { el, k } of fades) {
    const [a, b, c, d] = k;
    const fin = a < 0 ? 1 : smooth(range(p, a, b));
    const fout = 1 - smooth(range(p, c, d));
    const o = Math.min(fin, fout);
    const dir = fin < 1 ? 1 : -1;
    el.style.setProperty('--o', o.toFixed(3));
    el.style.setProperty('--y', `${((1 - o) * 26 * dir).toFixed(1)}px`);
    el.classList.toggle('off', o < 0.01);
  }

  // Tout le calque s'efface quand la section projets arrive
  const after = range(scrollY, journeyEnd, journeyEnd + innerHeight * 0.35);
  overlay.style.opacity = (1 - after).toFixed(3);
  overlay.style.visibility = after >= 1 ? 'hidden' : 'visible';
  hud.classList.toggle('hidden', p > 0.97);
  topbar.classList.toggle('solid', scrollY > journeyEnd + innerHeight * 0.2);

  const stage = p < 0.1 ? 0 : p < 0.3 ? 1 : p < SWITCH ? 2 : 3;
  stageEls.forEach((li, i) => li.classList.toggle('on', i === stage));

  // Nuages : on les traverse autour du changement de scène
  const cin = smooth(range(p, 0.41, 0.49));
  const cout = 1 - smooth(range(p, 0.51, 0.6));
  clouds.style.opacity = Math.min(cin, cout).toFixed(3);
  clouds.style.transform = `scale(${(1 + range(p, 0.41, 0.6) * 1.6).toFixed(3)})`;
  // Plongée finale vers le sol : on agrandit le canvas sous les nuages
  const dive = p < SWITCH ? easeOut(range(p, 0.36, SWITCH)) * 0.9 : 0;
  canvas.style.transform = dive > 0.001 ? `scale(${(1 + dive).toFixed(3)})` : '';
}

const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
function setAltitude(meters) {
  altEl.textContent = meters >= 10000 ? `${nf.format(meters / 1000)} km` : `${nf.format(meters)} m`;
}

/* ==========================================================
   Moteur 3D
   ========================================================== */
let renderer = null;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
} catch (e) {
  document.documentElement.classList.add('no-webgl');
}

const loader = new THREE.TextureLoader();
const maxAniso = renderer ? renderer.capabilities.getMaxAnisotropy() : 1;
function loadTex(url, srgb = true) {
  const t = loader.load(url);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = Math.min(8, maxAniso);
  return t;
}
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}
function canvasTex(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAniso;
  return t;
}
function glowTexture(inner = 'rgba(255,255,255,1)', mid = 'rgba(255,230,190,.35)') {
  const [c, g] = makeCanvas(128, 128);
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, inner);
  gr.addColorStop(0.18, mid);
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  return canvasTex(c);
}

function starField(count, rMin, rMax, size, { upperOnly = false } = {}) {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const c = new THREE.Color();
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    v.randomDirection();
    if (upperOnly) v.y = Math.abs(v.y) * 0.9 + 0.08;
    v.normalize().multiplyScalar(rand(rMin, rMax));
    pos.set([v.x, v.y, v.z], i * 3);
    if (Math.random() < 0.12) c.setHSL(rand(0.06, 0.12), 0.7, rand(0.7, 0.9));
    else c.setHSL(rand(0.55, 0.66), rand(0.1, 0.5), rand(0.55, 1));
    col.set([c.r, c.g, c.b], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return new THREE.Points(
    geo,
    new THREE.PointsMaterial({ size, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false, fog: false })
  );
}

/* ----------------------------------------------------------
   Scène 1 : l'espace et la Terre
   ---------------------------------------------------------- */
const space = new THREE.Scene();
const spaceCam = new THREE.PerspectiveCamera(40, 1, 0.002, 1000);

const stars = new THREE.Group();
stars.add(starField(3500, 150, 400, 1.3), starField(500, 150, 400, 2.3));
space.add(stars);

const BCN = { lat: 41.38, lon: 2.12 };
function latLon(lat, lon, r = 1) {
  const phi = (90 - lat) * D;
  const th = (lon + 180) * D;
  return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(th), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(th));
}
const bcnVec = latLon(BCN.lat, BCN.lon);
// Rotations qui amènent Barcelone face à la caméra (axe +Z)
const ryT = Math.atan2(-bcnVec.x, bcnVec.z);
const rxT = Math.atan2(bcnVec.y, Math.hypot(bcnVec.x, bcnVec.z));

// Barcelone finit juste côté jour, soleil rasant
const sunDir = new THREE.Vector3(-1, 0.28, 0.14).normalize();

const earth = new THREE.Group();
const spin = new THREE.Group();
earth.add(spin);
space.add(earth);

const earthMat = new THREE.ShaderMaterial({
  uniforms: {
    dayMap: { value: loadTex('assets/tex/earth_day_4096.jpg') },
    nightMap: { value: loadTex('assets/tex/earth_night_4096.jpg') },
    sunDir: { value: sunDir },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    varying vec3 vN;
    varying vec3 vViewN;
    void main() {
      vUv = uv;
      vN = normalize(mat3(modelMatrix) * normal);
      vViewN = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D dayMap;
    uniform sampler2D nightMap;
    uniform vec3 sunDir;
    varying vec2 vUv;
    varying vec3 vN;
    varying vec3 vViewN;
    void main() {
      float d = dot(normalize(vN), sunDir);
      float m = smoothstep(-0.18, 0.22, d);
      vec3 golden = mix(vec3(1.0, 0.62, 0.4), vec3(1.0), smoothstep(0.0, 0.45, d));
      vec3 day = texture2D(dayMap, vUv).rgb * golden * (0.12 + 1.1 * max(d, 0.0) + 0.25 * smoothstep(0.0, 0.3, d));
      vec3 night = texture2D(nightMap, vUv).rgb * vec3(1.0, 0.78, 0.5) * 2.2 + vec3(0.004, 0.007, 0.018);
      vec3 col = mix(night, day, m);
      float rim = pow(1.0 - max(dot(normalize(vViewN), vec3(0.0, 0.0, 1.0)), 0.0), 3.0);
      col += vec3(0.25, 0.5, 1.0) * rim * (0.15 + 0.6 * smoothstep(-0.3, 0.4, d));
      gl_FragColor = vec4(col, 1.0);
      #include <colorspace_fragment>
    }`,
});
spin.add(new THREE.Mesh(new THREE.SphereGeometry(1, 128, 96), earthMat));

const cloudMesh = new THREE.Mesh(
  new THREE.SphereGeometry(1.008, 96, 64),
  new THREE.MeshLambertMaterial({ map: loadTex('assets/tex/earth_clouds_1024.png'), transparent: true, opacity: 0.8, depthWrite: false })
);
spin.add(cloudMesh);

const atmoMat = new THREE.ShaderMaterial({
  uniforms: { strength: { value: 1 } },
  vertexShader: /* glsl */ `
    varying vec3 vN;
    void main() {
      vN = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform float strength;
    varying vec3 vN;
    void main() {
      float i = pow(0.68 - dot(vN, vec3(0.0, 0.0, 1.0)), 4.0);
      gl_FragColor = vec4(vec3(0.3, 0.6, 1.0) * i * strength, 1.0);
    }`,
  side: THREE.BackSide,
  blending: THREE.AdditiveBlending,
  transparent: true,
  depthWrite: false,
});
earth.add(new THREE.Mesh(new THREE.SphereGeometry(1.1, 64, 48), atmoMat));

const sun = new THREE.DirectionalLight(0xffffff, 2.4);
sun.position.copy(sunDir);
space.add(sun, new THREE.AmbientLight(0x334466, 0.12));

// Repère lumineux sur Barcelone
const marker = new THREE.Sprite(
  new THREE.SpriteMaterial({
    map: glowTexture('rgba(255,255,255,1)', 'rgba(255,80,140,.55)'),
    color: 0xffffff,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
);
marker.position.copy(latLon(BCN.lat, BCN.lon, 1.012));
spin.add(marker);

/* --- Surcouches satellite HD (tuiles Esri) pour le zoom sur l'Europe --- */
const ESRI = (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
const mercX = (lon, z) => ((lon + 180) / 360) * 256 * 2 ** z;
const mercY = (lat, z) => {
  const s = Math.sin(lat * D);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256 * 2 ** z;
};

const patchMaterials = [];
function makePatch({ z, lon0, lon1, lat0, lat1, radius, order }) {
  // Grille de tuiles qui couvre la zone
  const tx0 = Math.floor(mercX(lon0, z) / 256);
  const tx1 = Math.floor(mercX(lon1, z) / 256);
  const ty0 = Math.floor(mercY(lat1, z) / 256);
  const ty1 = Math.floor(mercY(lat0, z) / 256);
  const W = (tx1 - tx0 + 1) * 256;
  const H = (ty1 - ty0 + 1) * 256;
  const [c, g] = makeCanvas(W, H);
  const tex = canvasTex(c);
  tex.generateMipmaps = true;

  // Morceau de sphère avec des UV en projection Mercator
  const geo = new THREE.SphereGeometry(
    radius, 96, 72,
    (lon0 + 180) * D, (lon1 - lon0) * D,
    (90 - lat1) * D, (lat1 - lat0) * D
  );
  const pos = geo.attributes.position;
  const muv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), zz = pos.getZ(i);
    const lat = Math.asin(clamp(y / radius, -1, 1)) / D;
    const lon = Math.atan2(zz, -x) / D - 180;
    const lonN = lon < -180 ? lon + 360 : lon;
    muv[i * 2] = (mercX(lonN, z) - tx0 * 256) / W;
    muv[i * 2 + 1] = 1 - (mercY(lat, z) - ty0 * 256) / H;
  }
  geo.setAttribute('muv', new THREE.BufferAttribute(muv, 2));

  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: tex }, sunDir: { value: sunDir }, ready: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute vec2 muv;
      varying vec2 vUv;
      varying vec2 vM;
      varying vec3 vN;
      void main() {
        vUv = uv;
        vM = muv;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform vec3 sunDir;
      uniform float ready;
      varying vec2 vUv;
      varying vec2 vM;
      varying vec3 vN;
      void main() {
        vec4 t = texture2D(map, vM);
        float d = dot(normalize(vN), sunDir);
        vec3 golden = mix(vec3(1.0, 0.62, 0.4), vec3(1.0), smoothstep(0.0, 0.45, d));
        vec3 col = t.rgb * golden * (0.12 + 1.1 * max(d, 0.0) + 0.25 * smoothstep(0.0, 0.3, d));
        vec2 e = min(vUv, 1.0 - vUv);
        float edge = smoothstep(0.0, 0.12, e.x) * smoothstep(0.0, 0.12, e.y);
        float a = t.a * edge * smoothstep(-0.18, 0.22, d) * ready;
        gl_FragColor = vec4(col, a);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = order;
  spin.add(mesh);
  patchMaterials.push(mat);

  let pending = false;
  let started = false;
  return function load() {
    if (started) return;
    started = true;
    for (let x = tx0; x <= tx1; x++) {
      for (let y = ty0; y <= ty1; y++) {
        const im = new Image();
        im.crossOrigin = 'anonymous';
        im.decoding = 'async';
        im.onload = () => {
          g.drawImage(im, (x - tx0) * 256, (y - ty0) * 256);
          mat.uniforms.ready.value = 1;
          if (!pending) {
            pending = true;
            setTimeout(() => { tex.needsUpdate = true; pending = false; }, 250);
          }
        };
        im.src = ESRI(z, x, y);
      }
    }
  };
}
// Europe de l'Ouest (vue large) puis Catalogne (vue proche)
const loadEurope = makePatch({ z: 5, lon0: -30, lon1: 45, lat0: 18, lat1: 64, radius: 1.0006, order: 1 });
const loadCatalogne = makePatch({ z: 7, lon0: -8, lon1: 14, lat0: 33, lat1: 49, radius: 1.0012, order: 2 });


/* ==========================================================
   Descente réelle : imagerie satellite puis photos du Camp Nou
   ========================================================== */
const ground = document.getElementById('ground');
const mapCanvas = document.getElementById('map');
const mctx = mapCanvas.getContext('2d');

// Centre du terrain du Camp Nou
const CN = { lat: 41.38088, lon: 2.12282 };
const TILE_URL = (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
const Z_START = 6.5;
const Z_END = 18.4;
const MAX_LEVEL = 18;

const tiles = new Map();
let mapDirty = true;
function getTile(l, x, y, request) {
  const n = 2 ** l;
  if (y < 0 || y >= n) return null;
  x = ((x % n) + n) % n;
  const key = `${l}/${x}/${y}`;
  let im = tiles.get(key);
  if (!im && request) {
    im = new Image();
    im.decoding = 'async';
    im.onload = () => { im.ok = true; mapDirty = true; };
    im.src = TILE_URL(l, x, y);
    tiles.set(key, im);
  }
  return im && im.ok ? im : null;
}
function worldPx(l) {
  const n = 256 * 2 ** l;
  const s = Math.sin(CN.lat * D);
  return [((CN.lon + 180) / 360) * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
}

let prefetched = false;
function prefetchTiles() {
  prefetched = true;
  for (let l = Math.floor(Z_START); l <= MAX_LEVEL; l++) {
    const [cx, cy] = worldPx(l);
    const tx = Math.floor(cx / 256);
    const ty = Math.floor(cy / 256);
    const r = l < 12 ? 2 : 3;
    for (let dx = -r; dx <= r; dx++) for (let dy = -r + 1; dy <= r - 1; dy++) getTile(l, tx + dx, ty + dy, true);
  }
}

let mapDpr = 1;
let lastZ = -1;
let lastAng = 0;
function drawMap(z, ang) {
  if (!mapDirty && Math.abs(z - lastZ) < 1e-4 && Math.abs(ang - lastAng) < 1e-5) return;
  mapDirty = false;
  lastZ = z;
  lastAng = ang;
  const W = innerWidth;
  const H = innerHeight;
  mctx.setTransform(mapDpr, 0, 0, mapDpr, 0, 0);
  mctx.fillStyle = '#1d2a33';
  mctx.fillRect(0, 0, W, H);
  const target = Math.min(MAX_LEVEL, Math.max(0, Math.ceil(z - 0.15)));
  const R = Math.hypot(W, H) / 2;
  for (let l = Math.max(0, target - 4); l <= target; l++) {
    const s = 2 ** (z - l);
    const [cx, cy] = worldPx(l);
    const x0 = Math.floor((cx - R / s) / 256);
    const x1 = Math.floor((cx + R / s) / 256);
    const y0 = Math.floor((cy - R / s) / 256);
    const y1 = Math.floor((cy + R / s) / 256);
    mctx.save();
    mctx.translate(W / 2, H / 2);
    mctx.rotate(ang);
    mctx.scale(s, s);
    mctx.translate(-cx, -cy);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const im = getTile(l, x, y, l === target);
        if (im) mctx.drawImage(im, x * 256, y * 256, 256 + 1 / s, 256 + 1 / s);
      }
    }
    mctx.restore();
  }
}

function renderGround(p) {
  const on = p >= SWITCH - 0.02;
  ground.style.visibility = on ? 'visible' : 'hidden';
  if (!on) return;

  // Satellite : de la côte catalane jusqu'au Camp Nou, puis la section projets arrive
  const tM = range(p, SWITCH, 1);
  const z = lerp(Z_START, Z_END, 1 - Math.pow(1 - tM, 1.25));
  const ang = (1 - easeOut(tM)) * -0.5;
  drawMap(z, reduceMotion ? 0 : ang);

  const mpp = (156543.03 * Math.cos(CN.lat * D)) / 2 ** z;
  setAltitude(mpp * innerHeight * 1.37);
}

/* ==========================================================
   Rendu
   ========================================================== */
let portrait = false;
function resize() {
  measure();
  readScroll();
  mapDpr = Math.min(devicePixelRatio || 1, 2);
  mapCanvas.width = Math.round(innerWidth * mapDpr);
  mapCanvas.height = Math.round(innerHeight * mapDpr);
  mapDirty = true;
  if (!renderer) return;
  const w = innerWidth;
  const h = innerHeight;
  renderer.setSize(w, h, false);
  portrait = w / h < 0.9;
  spaceCam.aspect = w / h;
  spaceCam.fov = portrait ? 55 : 40;
  spaceCam.updateProjectionMatrix();
}

function renderSpace(p, t) {
  const tE = range(p, 0.03, SWITCH);
  const turn = ease(range(tE, 0, 0.8));
  const zoom = ease(tE);
  const alt = 7 * Math.pow(0.42 / 7, zoom); // en rayons terrestres
  spaceCam.position.set(0, 0, 1 + alt);
  spaceCam.lookAt(0, 0, 0);

  const off = 1 - easeOut(range(tE, 0, 0.55));
  if (portrait) earth.position.set(0, -2.6 * off, 0);
  else earth.position.set(1.75 * off, -0.1 * off, 0);

  const idle = reduceMotion ? 0 : t * 0.03;
  spin.rotation.set(lerp(0.32, rxT, turn), ryT - (1 - turn) * (2.4 + idle), 0);
  cloudMesh.rotation.y = reduceMotion ? 0 : t * 0.004;
  // Les nuages globaux sont basse définition : on les efface en approche
  cloudMesh.material.opacity = 0.8 * (1 - range(tE, 0.35, 0.7));
  stars.rotation.y = t * 0.002;

  const show = range(tE, 0.3, 0.5) * (1 - range(tE, 0.92, 1));
  marker.material.opacity = show;
  marker.scale.setScalar(0.06 * (1 + 0.25 * Math.sin(t * 4)) * lerp(1, 0.25, zoom));
  atmoMat.uniforms.strength.value = lerp(1, 0.35, range(tE, 0.7, 1));

  setAltitude(alt * 6371000);
  renderer.render(space, spaceCam);
}

let jumpOnce = false;
function frame(now) {
  requestAnimationFrame(frame);
  const t = now / 1000;
  const k = reduceMotion || jumpOnce ? 1 : 0.075;
  jumpOnce = false;
  prog += (target - prog) * k;
  if (Math.abs(target - prog) < 1e-5) prog = target;

  updateOverlays(prog);
  if (prog > 0.02) loadCatalogne();
  if (!prefetched && prog > 0.2) prefetchTiles();
  if (scrollY > journeyEnd + innerHeight * 1.2) return; // la section projets couvre tout
  canvas.style.visibility = prog < SWITCH + 0.01 ? 'visible' : 'hidden';
  if (renderer && prog < SWITCH + 0.01) renderSpace(Math.min(prog, SWITCH), t);
  renderGround(prog);
}

/* ==========================================================
   Univers 02 : changement de monde en pixels, puis mode arcade
   ========================================================== */
document.documentElement.classList.add('js');
const arcade = document.getElementById('arcade');
const wipe = document.getElementById('pixelwipe');
const wctx = wipe.getContext('2d');
const warpScreen = document.getElementById('warp-screen');
const wsSmall = document.getElementById('ws-small');
const wsBig = document.getElementById('ws-big');
const wsSub = document.getElementById('ws-sub');
const scoreEl = document.getElementById('score');
const coinsEl = document.getElementById('coins');
const WIPE_BG = '#07051a';
const WIPE_SPARK = ['#ffcc33', '#8f7bff', '#4fe3ff', '#ff4d6d', '#a50044', '#004d98'];

let cell = 38;
let order = [];
function setupWipe() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  cell = innerWidth < 640 ? 26 : 38;
  wipe.width = Math.round(innerWidth * dpr);
  wipe.height = Math.round(innerHeight * dpr);
  wctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cols = Math.ceil(innerWidth / cell);
  const rows = Math.ceil(innerHeight / cell);
  // Balayage en diagonale, avec du bruit pour l'effet « pixels qui tombent »
  order = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) order.push([x * cell, y * cell, (x + y) / (cols + rows) + Math.random() * 0.35]);
  }
  order.sort((a, b) => a[2] - b[2]);
}

// fill : 0 → 1 recouvre l'écran ; clear : 0 → 1 le découvre
function drawWipe(fill, clear) {
  const n = order.length;
  const a = Math.floor(clear * n);
  const b = Math.floor(fill * n);
  wctx.clearRect(0, 0, innerWidth, innerHeight);
  const edge = Math.max(1, Math.floor(n * 0.05));
  for (let i = a; i < b; i++) {
    const front = (fill < 1 && i >= b - edge) || (clear > 0 && i < a + edge);
    wctx.fillStyle = front ? WIPE_SPARK[(i * 7) % WIPE_SPARK.length] : WIPE_BG;
    wctx.fillRect(order[i][0], order[i][1], cell + 0.5, cell + 0.5);
  }
}

function tween(ms, step) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / ms);
      step(k);
      if (k < 1) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// Le scroll est bloqué pendant le changement de monde
const block = (e) => e.preventDefault();
function lockScroll(on) {
  document.documentElement.style.overflow = on ? 'hidden' : '';
  const fn = on ? addEventListener : removeEventListener;
  fn('wheel', block, { passive: false });
  fn('touchmove', block, { passive: false });
}
function jumpTo(y) {
  window.scrollTo(0, y);
  readScroll();
}

let inArcade = false;
let warping = false;
async function changeWorld(toArcade) {
  warping = true;
  // Après un clic dans le menu, on garde la destination ; sinon on se cale au début du monde
  const from = scrollY;
  lockScroll(true);
  wsSmall.textContent = toArcade ? 'Univers 02' : 'Univers 01';
  wsBig.textContent = toArcade ? 'WORLD 2' : 'WORLD 1';
  wsSub.textContent = toArcade ? 'Jeux vidéo' : 'FC Barcelona';
  wipe.style.visibility = 'visible';
  const speed = reduceMotion ? 0.01 : toArcade ? 1 : 0.7;

  await tween(520 * speed, (k) => drawWipe(ease(k), 0));
  inArcade = toArcade;
  document.body.classList.toggle('arcade', toArcade);
  jumpTo(toArcade ? Math.max(from, arcade.offsetTop) : Math.min(from, arcade.offsetTop - innerHeight * 1.25));
  warpScreen.style.visibility = 'visible';
  await tween(180 * speed, (k) => { warpScreen.style.opacity = k; });
  await pause(toArcade ? 900 * speed : 550 * speed);
  await tween(180 * speed, (k) => { warpScreen.style.opacity = 1 - k; });
  warpScreen.style.visibility = 'hidden';
  await tween(560 * speed, (k) => drawWipe(1, ease(k)));
  wipe.style.visibility = 'hidden';

  lockScroll(false);
  warping = false;
  checkWorld();
}

// Entrée : dès la fin de la page du monde Barça. Sortie : quand l'arcade est ressortie de l'écran par le bas.
function checkWorld() {
  if (warping) return;
  const top = arcade.getBoundingClientRect().top;
  if (!inArcade && top < innerHeight * 0.97) changeWorld(true);
  else if (inArcade && top > innerHeight * 1.08) changeWorld(false);
}

let bestScore = 0;
function updateArcade() {
  checkWorld();
  if (!inArcade) return;
  bestScore = Math.max(bestScore, Math.floor(Math.max(0, scrollY - arcade.offsetTop + innerHeight) / 4) * 10);
  scoreEl.textContent = String(bestScore).padStart(6, '0');
}

// Les niveaux apparaissent en « pas » pixel, et rapportent une pièce chacun
let coins = 0;
const levelObs = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    e.target.classList.add('in');
    levelObs.unobserve(e.target);
    coins++;
    coinsEl.textContent = String(coins).padStart(2, '0');
  }
}, { threshold: 0.2 });
document.querySelectorAll('[data-level]').forEach((el) => levelObs.observe(el));

// Galeries : une vignette remplace l'image de l'écran
document.querySelectorAll('.cabinet').forEach((cab) => {
  const main = cab.querySelector('.crt-main');
  cab.querySelectorAll('.thumbs button').forEach((btn) => {
    btn.addEventListener('click', () => {
      cab.querySelector('.crt iframe')?.remove();
      cab.querySelectorAll('.thumbs button').forEach((b) => b.classList.toggle('on', b === btn));
      const img = btn.querySelector('img');
      main.src = img.src;
      main.alt = img.alt;
    });
  });
});

// Trailers : la vidéo YouTube ne se charge qu'au clic
document.querySelectorAll('.trailer[data-yt]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const f = document.createElement('iframe');
    f.src = `https://www.youtube-nocookie.com/embed/${btn.dataset.yt}?autoplay=1&rel=0&modestbranding=1`;
    f.title = btn.getAttribute('aria-label');
    f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    f.allowFullscreen = true;
    btn.closest('.crt').appendChild(f);
  });
});

addEventListener('scroll', updateArcade, { passive: true });
addEventListener('resize', setupWipe);
setupWipe();
// Page rechargée déjà dans l'arcade : pas d'animation
if (arcade.getBoundingClientRect().top < innerHeight * 0.97) {
  inArcade = true;
  document.body.classList.add('arcade');
}
updateArcade();

/* ==========================================================
   Démarrage
   ========================================================== */
addEventListener('resize', resize);
addEventListener('scroll', readScroll, { passive: true });
resize();
setTimeout(loadEurope, 600);

// Aperçu figé d'une étape (développement) : ?p=0.75
const qp = parseFloat(new URLSearchParams(location.search).get('p'));
if (!Number.isNaN(qp)) {
  frozen = true;
  target = prog = clamp(qp);
  jumpOnce = true;
  loadEurope();
  loadCatalogne();
  if (qp > 0.2) prefetchTiles();
}

requestAnimationFrame(frame);

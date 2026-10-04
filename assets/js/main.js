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

// Chargement d'images hors du fil principal : le décodage des centaines de tuiles
// satellite ne bloque plus l'animation (c'était la cause des saccades sur téléphone)
const imgQueue = [];
let imgActive = 0;
const IMG_MAX = 8;
let pauseBackground = false; // pendant le voyage automatique, seules les images urgentes passent
function pumpImages() {
  while (imgActive < IMG_MAX && imgQueue.length) {
    const i = pauseBackground ? imgQueue.findIndex((j) => j.urgent) : 0;
    if (i < 0) return;
    const [{ url, resolve }] = imgQueue.splice(i, 1);
    imgActive++;
    fetch(url, { mode: 'cors' })
      .then((r) => (r.ok ? r.blob() : Promise.reject()))
      .then((blob) => createImageBitmap(blob))
      .then(resolve, () => resolve(null))
      .finally(() => { imgActive--; pumpImages(); });
  }
}
function loadBitmap(url, urgent = false) {
  let job;
  const promise = new Promise((resolve) => {
    job = { url, resolve, urgent };
    imgQueue[urgent ? 'unshift' : 'push'](job);
    pumpImages();
  });
  promise.job = job;
  return promise;
}
// Une image préchargée « plus tard » devient urgente : on la remonte en tête de file
function bumpBitmap(job) {
  job.urgent = true;
  const i = imgQueue.indexOf(job);
  if (i > 0) { imgQueue.splice(i, 1); imgQueue.unshift(job); }
  pumpImages();
}

const journey = document.getElementById('journey');
const overlay = document.getElementById('overlay');
const canvas = document.getElementById('scene');
const clouds = document.getElementById('clouds');
const topbar = document.querySelector('.topbar');
const hud = document.querySelector('.hud');
const altEl = document.getElementById('alt');
const stageEls = [...document.querySelectorAll('#stages li')];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
// Téléphones et tablettes : on allège le rendu pour garder un scroll fluide
const COARSE = matchMedia('(pointer: coarse)').matches || innerWidth < 700;

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

// N'écrit un style que s'il a changé : sur téléphone, les recalculs de style
// à chaque image étaient l'une des causes des saccades
const styleCache = new WeakMap();
function setStyle(el, prop, val) {
  let c = styleCache.get(el);
  if (!c) styleCache.set(el, (c = {}));
  if (c[prop] === val) return;
  c[prop] = val;
  el.style[prop] = val;
}
function setClass(el, name, on) {
  const key = `.${name}`;
  let c = styleCache.get(el);
  if (!c) styleCache.set(el, (c = {}));
  if (c[key] === on) return;
  c[key] = on;
  el.classList.toggle(name, on);
}

function updateOverlays(p) {
  for (const { el, k } of fades) {
    const [a, b, c, d] = k;
    const fin = a < 0 ? 1 : smooth(range(p, a, b));
    const fout = 1 - smooth(range(p, c, d));
    const o = Math.min(fin, fout);
    const dir = fin < 1 ? 1 : -1;
    setStyle(el, 'opacity', o.toFixed(2));
    setStyle(el, 'transform', `translate3d(0, ${Math.round((1 - o) * 26 * dir)}px, 0)`);
    setClass(el, 'off', o < 0.01);
  }

  // Tout le calque s'efface quand la section projets arrive
  const after = range(scrollY, journeyEnd, journeyEnd + innerHeight * 0.35);
  setStyle(overlay, 'opacity', (1 - after).toFixed(2));
  setStyle(overlay, 'visibility', after >= 1 ? 'hidden' : 'visible');
  setClass(hud, 'hidden', p > 0.97 || (portrait && p < 0.06));
  setClass(topbar, 'solid', scrollY > journeyEnd + innerHeight * 0.2);

  const stage = p < 0.1 ? 0 : p < 0.3 ? 1 : p < SWITCH ? 2 : 3;
  stageEls.forEach((li, i) => setClass(li, 'on', i === stage));

  // Nuages : on les traverse autour du changement de scène
  const cin = smooth(range(p, 0.41, 0.49));
  const cout = 1 - smooth(range(p, 0.51, 0.6));
  setStyle(clouds, 'opacity', Math.min(cin, cout).toFixed(2));
  // Invisibles : on les retire du rendu plutôt que de les composer pour rien
  setStyle(clouds, 'visibility', Math.min(cin, cout) < 0.01 ? 'hidden' : 'visible');
  setStyle(clouds, 'transform', `scale(${(1 + range(p, 0.41, 0.6) * 1.6).toFixed(3)})`);
  // Plongée finale vers le sol : on agrandit le canvas sous les nuages
  const dive = p < SWITCH ? easeOut(range(p, 0.36, SWITCH)) * 0.9 : 0;
  setStyle(canvas, 'transform', dive > 0.001 ? `scale(${(1 + dive).toFixed(3)})` : '');
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
  renderer.setPixelRatio(Math.min(devicePixelRatio, COARSE ? 1.25 : 1.75));
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
    dayMap: { value: loadTex(`assets/tex/earth_day_${COARSE ? 2048 : 4096}.jpg`) },
    nightMap: { value: loadTex(`assets/tex/earth_night_${COARSE ? 2048 : 4096}.jpg`) },
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

  let started = false;
  return function load() {
    if (started) return;
    started = true;
    const total = (tx1 - tx0 + 1) * (ty1 - ty0 + 1);
    let done = 0;
    for (let x = tx0; x <= tx1; x++) {
      for (let y = ty0; y <= ty1; y++) {
        loadBitmap(ESRI(z, x, y)).then((bmp) => {
          done++;
          if (bmp) g.drawImage(bmp, (x - tx0) * 256, (y - ty0) * 256);
          // Une seule mise à jour de la texture, une fois toutes les images reçues :
          // l'envoyer au GPU (avec ses mipmaps) à chaque image provoquait des à-coups
          if (done === total) {
            tex.needsUpdate = true;
            // Envoi immédiat au GPU, avant que le visiteur ne lance le voyage
            if (renderer) renderer.initTexture(tex);
            mat.uniforms.ready.value = 1;
          }
        });
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
// Zoom de départ de la carte, calé sur la vue du globe juste avant les nuages (recalculé au redimensionnement)
let Z_START = 6.5;
const Z_END = 18.4;
const MAX_LEVEL = 18;

const tiles = new Map();
let mapDirty = true;
function getTile(l, x, y, request) {
  const n = 2 ** l;
  if (y < 0 || y >= n) return null;
  x = ((x % n) + n) % n;
  const key = `${l}/${x}/${y}`;
  let t = tiles.get(key);
  if (!t && request) {
    t = { bmp: null };
    tiles.set(key, t);
    // Les tuiles affichées maintenant passent avant le préchargement
    const pr = loadBitmap(TILE_URL(l, x, y), request === 'now');
    t.job = pr.job;
    pr.then((bmp) => { t.bmp = bmp; t.job = null; if (bmp) mapDirty = true; });
  } else if (t && t.job && request === 'now') bumpBitmap(t.job);
  return t && t.bmp ? t.bmp : null;
}
// Centre de la carte : le Camp Nou au début, Roland-Garros pour le retour dans l'espace
let mapCenter = CN;
function setMapCenter(c) {
  if (c !== mapCenter) { mapCenter = c; mapDirty = true; }
}
function worldPx(l, c = mapCenter) {
  const n = 256 * 2 ** l;
  const s = Math.sin(c.lat * D);
  return [((c.lon + 180) / 360) * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
}

let prefetched = false;
function prefetchTiles(c = CN) {
  if (c === CN) prefetched = true;
  for (let l = Math.floor(Z_START); l <= MAX_LEVEL; l++) {
    const [cx, cy] = worldPx(l, c);
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
  // Un niveau de base peu détaillé (déjà chargé) est toujours dessiné en dessous :
  // s'il manque des images plus précises, on voit une carte floue, jamais un écran noir
  const base = Math.min(target, Math.floor(Z_START) + 1);
  const levels = [base];
  for (let l = Math.max(base + 1, target - (COARSE ? 2 : 3)); l <= target; l++) levels.push(l);
  for (const l of levels) {
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
        const im = getTile(l, x, y, (l === base || l >= target - 2) && 'now');
        if (im) mctx.drawImage(im, x * 256, y * 256, 256 + 1 / s, 256 + 1 / s);
      }
    }
    mctx.restore();
  }
  // Vignettage (assombrit les bords pour la lisibilité des textes)
  if (!vignette || vignette.w !== W || vignette.h !== H) {
    const top = mctx.createLinearGradient(0, 0, 0, H);
    top.addColorStop(0, 'rgba(5,6,11,.55)');
    top.addColorStop(0.22, 'rgba(5,6,11,0)');
    top.addColorStop(0.62, 'rgba(5,6,11,0)');
    top.addColorStop(1, 'rgba(5,6,11,.7)');
    const rad = mctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.45, W / 2, H / 2, Math.hypot(W, H) * 0.6);
    rad.addColorStop(0, 'rgba(5,6,11,0)');
    rad.addColorStop(1, 'rgba(5,6,11,.45)');
    vignette = { w: W, h: H, top, rad };
  }
  mctx.fillStyle = vignette.top;
  mctx.fillRect(0, 0, W, H);
  mctx.fillStyle = vignette.rad;
  mctx.fillRect(0, 0, W, H);
}
let vignette = null;

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
let lastW = 0;
let lastH = 0;
function resize() {
  measure();
  readScroll();
  // Sur mobile, la barre d'adresse qui apparaît/disparaît change la hauteur :
  // on ne recrée pas les canvas pour si peu (c'était une source de saccades)
  if (COARSE && innerWidth === lastW && Math.abs(innerHeight - lastH) < 160) return;
  lastW = innerWidth;
  lastH = innerHeight;
  mapDpr = Math.min(devicePixelRatio || 1, COARSE ? 1.25 : 1.5);
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
  // Même échelle que le globe à la fin de sa plongée (altitude 0,42 rayon, canvas agrandi ×1,9)
  const mppGlobe = (2 * 0.42 * 6371000 * Math.tan((spaceCam.fov * D) / 2)) / h / 1.9;
  Z_START = clamp(Math.log2((156543.03 * Math.cos(CN.lat * D)) / mppGlobe), 5, 7.5);
  mapDirty = true;
}

function renderSpace(p, t) {
  const tE = range(p, 0.03, SWITCH);
  const turn = ease(range(tE, 0, 0.8));
  const zoom = ease(tE);
  const alt = 7 * Math.pow(0.42 / 7, zoom); // en rayons terrestres
  spaceCam.position.set(0, 0, 1 + alt);
  spaceCam.lookAt(0, 0, 0);

  const off = 1 - easeOut(range(tE, 0, 0.55));
  // Sur téléphone, la Terre est en haut et la carte de présentation en bas
  if (portrait) earth.position.set(0, 2.35 * off, 0);
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
  marker.position.copy(BCN_MARK);
  renderer.render(space, spaceCam);
}

// Fin du voyage : la Terre tourne doucement, le repère est posé sur la Normandie
const BCN_MARK = latLon(BCN.lat, BCN.lon, 1.012);
const NORMANDIE = { lat: 49.18, lon: -0.37 };
const NORM_MARK = latLon(NORMANDIE.lat, NORMANDIE.lon, 1.012);
const normVec = latLon(NORMANDIE.lat, NORMANDIE.lon);
const ryN = Math.atan2(-normVec.x, normVec.z);
const rxN = Math.atan2(normVec.y, Math.hypot(normVec.x, normVec.z));
const RG = { lat: 48.8459, lon: 2.2534 }; // Roland-Garros
const rgVec = latLon(RG.lat, RG.lon);
const ryR = Math.atan2(-rgVec.x, rgVec.z);
const rxR = Math.atan2(rgVec.y, Math.hypot(rgVec.x, rgVec.z));
// k : 0 = tout près de Paris, 1 = vue finale
function renderOutro(t, k = 1) {
  const e = ease(k);
  spaceCam.position.set(0, 0, lerp(1.42, 4.4, 1 - Math.pow(1 - k, 2.2)));
  spaceCam.lookAt(0, 0, 0);
  if (portrait) earth.position.set(0, -1.75 * e, 0);
  else earth.position.set(1.7 * e, -0.05 * e, 0);
  const sway = reduceMotion ? 0 : Math.sin(t * 0.12) * 0.5 * e;
  spin.rotation.set(lerp(rxR, rxN * 0.8, e), lerp(ryR, ryN, e) + sway, 0);
  cloudMesh.rotation.y = reduceMotion ? 0 : t * 0.004;
  cloudMesh.material.opacity = 0.8;
  stars.rotation.y = t * 0.002;
  marker.position.copy(NORM_MARK);
  marker.material.opacity = 1;
  marker.scale.setScalar(0.05 * (1 + 0.25 * Math.sin(t * 4)));
  atmoMat.uniforms.strength.value = 1;
  renderer.render(space, spaceCam);
}

let jumpOnce = false;
let lastProg = -1;
let lastScrollY = -1;
let idleTick = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const t = now / 1000;
  const k = reduceMotion || jumpOnce ? 1 : 0.075;
  jumpOnce = false;
  prog += (target - prog) * k;
  if (Math.abs(target - prog) < 1e-5) prog = target;

  // Rien ne bouge (scroll arrêté) : on ne refait que l'animation de la Terre, à 30 images/s
  const still = prog === lastProg && scrollY === lastScrollY && world !== LAST;
  lastProg = prog;
  lastScrollY = scrollY;
  if (still && (++idleTick % 2 || scrollY > journeyEnd + innerHeight * 1.2 || (prog >= SWITCH && !mapDirty))) return;
  if (!still) idleTick = 0;
  updateOverlays(prog);
  if (prog > 0.02) loadCatalogne();
  if (!prefetched && prog > 0.2) prefetchTiles();
  if (world === LAST) {
    if (outroK !== null && outroK < OUTRO_SWAP) {
      // 1re partie : dézoom satellite depuis Roland-Garros
      const k = outroK / OUTRO_SWAP;
      setMapCenter(RG);
      ground.style.visibility = 'visible';
      mapCanvas.style.opacity = 1;
      canvas.style.visibility = 'hidden';
      drawMap(lerp(COARSE ? 17.6 : 18.6, Z_START, 1 - Math.pow(1 - k, 1.6)), reduceMotion ? 0 : -0.5 * easeOut(k));
    } else {
      ground.style.visibility = 'hidden';
      canvas.style.visibility = 'visible';
      if (renderer) renderOutro(t, outroK === null ? 1 : range(outroK, OUTRO_SWAP, 1));
    }
    // Les nuages masquent le passage de la carte au globe
    const ck = outroK === null ? 1 : outroK;
    const co = Math.min(smooth(range(ck, OUTRO_SWAP - 0.1, OUTRO_SWAP - 0.02)), 1 - smooth(range(ck, OUTRO_SWAP + 0.02, OUTRO_SWAP + 0.14)));
    setStyle(clouds, 'opacity', co.toFixed(2));
    setStyle(clouds, 'visibility', co < 0.01 ? 'hidden' : 'visible');
    setStyle(clouds, 'transform', `scale(${(2.6 - range(ck, OUTRO_SWAP - 0.1, OUTRO_SWAP + 0.14) * 1.6).toFixed(3)})`);
    return;
  }
  setMapCenter(CN);
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
// On bloque les gestes sans masquer la barre de défilement : la masquer changeait la
// largeur de la page et forçait un recalcul complet (gros à-coup au début des animations)
const SCROLL_KEYS = ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' ', 'Spacebar'];
const blockKeys = (e) => { if (SCROLL_KEYS.includes(e.key)) e.preventDefault(); };
function lockScroll(on) {
  const fn = on ? addEventListener : removeEventListener;
  fn('wheel', block, { passive: false });
  fn('touchmove', block, { passive: false });
  fn('keydown', blockKeys);
}
function jumpTo(y) {
  window.scrollTo(0, y);
  readScroll();
}

/* ---------- Les trois mondes ---------- */
const boutique = document.getElementById('boutique');
const shopfront = document.getElementById('shopfront');
const sfScene = shopfront.querySelector('.sf-scene');
const sfDoor = shopfront.querySelector('.sf-door');
const sfL = shopfront.querySelector('.sf-l');
const sfR = shopfront.querySelector('.sf-r');
const ecole = document.getElementById('etudeasy');
const f1 = document.getElementById('f1');
const tennis = document.getElementById('tennis');
const fin = document.getElementById('contact');
const WORLD_TOP = { 2: arcade, 3: boutique, 4: ecole, 5: f1, 6: tennis, 7: fin };
const WORLD_START = Object.fromEntries(Object.entries(WORLD_TOP).map(([n, el]) => [n, () => el.offsetTop]));
const LAST = 7;

let world = 1;
let warping = false;

function setWorld(n) {
  world = n;
  document.body.classList.toggle('arcade', n === 2);
  document.body.classList.toggle('boutique', n === 3);
  document.body.classList.toggle('ecole', n === 4);
  document.body.classList.toggle('f1-mode', n === 5);
  document.body.classList.toggle('tennis-mode', n === 6);
  if (n === 6) prefetchTiles(RG);
  document.body.classList.toggle('espace', n === 7);
  // Les prototypes d'applis ne tournent que dans leur univers
  document.querySelectorAll('.duo-phone iframe').forEach((f) => {
    const on = f.closest('section') === WORLD_TOP[n];
    if (on && !f.src) f.src = f.dataset.src;
    // Fermée après la transition, pour ne pas provoquer d'à-coup pendant l'animation
    else if (!on && f.src) setTimeout(() => { if (f.closest('section') !== WORLD_TOP[world]) f.removeAttribute('src'); }, 6000);
  });
}

// Une fois l'écran couvert, on se place dans le bon monde : au début si on avance,
// un peu avant la fin si on recule. Une destination choisie dans le menu est conservée.
function landIn(n, from) {
  const forward = n > world;
  setWorld(n);
  const start = n === 1 ? 0 : WORLD_START[n]();
  const end = n === LAST ? Infinity : WORLD_START[n + 1]();
  if (forward) jumpTo(Math.max(from, start));
  else jumpTo(Math.min(from, end - innerHeight * 1.25));
}

/* Transition 1 ↔ 2 : pixels + écran « WORLD » */
async function pixelWarp(to, from) {
  const toArcade = to === 2;
  wsSmall.textContent = toArcade ? 'Univers 02' : 'Univers 01';
  wsBig.textContent = toArcade ? 'WORLD 2' : 'WORLD 1';
  wsSub.textContent = toArcade ? 'Jeux vidéo' : 'FC Barcelona';
  wipe.style.visibility = 'visible';
  const speed = reduceMotion ? 0.01 : toArcade ? 1 : 0.7;

  await tween(520 * speed, (k) => drawWipe(ease(k), 0));
  landIn(to, from);
  warpScreen.style.visibility = 'visible';
  await tween(180 * speed, (k) => { warpScreen.style.opacity = k; });
  await pause(toArcade ? 900 * speed : 550 * speed);
  await tween(180 * speed, (k) => { warpScreen.style.opacity = 1 - k; });
  warpScreen.style.visibility = 'hidden';
  await tween(560 * speed, (k) => drawWipe(1, ease(k)));
  wipe.style.visibility = 'hidden';
}

/* Transition vers / depuis l'univers e-commerce : la façade, puis les portes qui s'ouvrent */
function sceneAt(y, scale, doorOpen, alpha = 1) {
  sfScene.style.transform = `translateY(${y}%) scale(${scale})`;
  sfL.style.transform = `rotateY(${-doorOpen * 105}deg)`;
  sfR.style.transform = `rotateY(${doorOpen * 105}deg)`;
  shopfront.style.opacity = alpha;
}
function aimAtDoor() {
  const r = sfDoor.getBoundingClientRect();
  sfScene.style.transformOrigin = `${r.left + r.width / 2}px ${r.top + r.height * 0.55}px`;
}
async function doorWarp(to, from) {
  const speed = reduceMotion ? 0.01 : 1;
  shopfront.style.visibility = 'visible';
  sfScene.style.transformOrigin = '50% 50%';
  sceneAt(0, 1, 0);
  aimAtDoor();

  if (to === 3) {
    // On arrive devant le magasin, les portes s'ouvrent, on entre
    await tween(520 * speed, (k) => sceneAt(100 * (1 - ease(k)), 1, 0));
    landIn(3, from);
    await pause(260 * speed);
    await tween(760 * speed, (k) => sceneAt(0, 1 + 0.12 * ease(k), ease(k)));
    await tween(640 * speed, (k) => sceneAt(0, 1.12 + 2.4 * ease(k), 1, 1 - smooth(range(k, 0.35, 1))));
  } else {
    // On ressort : recul depuis l'intérieur, les portes se referment, la façade s'éloigne
    await tween(420 * speed, (k) => sceneAt(0, 3.5 - 2.38 * ease(k), 1, smooth(k)));
    await tween(520 * speed, (k) => sceneAt(0, 1.12 - 0.12 * ease(k), 1 - ease(k)));
    landIn(to, from);
    await pause(180 * speed);
    await tween(460 * speed, (k) => sceneAt(100 * ease(k), 1, 0));
  }
  shopfront.style.visibility = 'hidden';
  shopfront.style.opacity = 1;
}

/* Transition vers / depuis l'école : le tableau noir descend, la craie écrit, il remonte */
const board = document.getElementById('chalkboard');
const cbBoard = board.querySelector('.cb-board');
const cbTexts = ['cb-small', 'cb-big', 'cb-sub'].map((id) => document.getElementById(id));
const cbLine = board.querySelector('.cb-line');
const CHALK = {
  1: ['Univers 01', 'FC Barcelona', 'Retour au Camp Nou'],
  2: ['Univers 02', 'Jeux vidéo', "Retour à l'arcade"],
  3: ['Univers 03', 'E-commerce', 'Retour au magasin'],
  4: ['Univers 04', 'EtudEasy', 'Application mobile'],
};
function writeChalk(k) {
  // Chaque ligne s'écrit l'une après l'autre, de gauche à droite
  cbTexts.forEach((el, i) => {
    const t = clamp(k * 3.2 - i * 0.9);
    el.style.clipPath = `inset(0 ${(1 - t) * 100}% 0 0)`;
  });
  cbLine.style.strokeDashoffset = 340 * (1 - clamp(k * 3.2 - 2.4));
}
async function chalkWarp(to, from) {
  const speed = reduceMotion ? 0.01 : 1;
  const forward = to === 4;
  CHALK[to].forEach((txt, i) => { cbTexts[i].textContent = txt; });
  writeChalk(0);
  board.style.visibility = 'visible';
  cbBoard.style.transform = 'translateY(-100%)';

  // Le tableau descend avec un petit rebond
  await tween(560 * speed, (k) => {
    const b = k < 0.75 ? ease(k / 0.75) : 1 + Math.sin((k - 0.75) / 0.25 * Math.PI) * 0.025;
    cbBoard.style.transform = `translateY(${(b - 1) * 100}%)`;
  });
  landIn(to, from);
  await tween((forward ? 1150 : 700) * speed, writeChalk);
  await pause((forward ? 420 : 200) * speed);
  await tween(560 * speed, (k) => { cbBoard.style.transform = `translateY(${-100 * ease(k)}%)`; });
  board.style.visibility = 'hidden';
}

const NAMES = { 1: 'FC Barcelona', 2: 'Jeux vidéo', 3: 'E-commerce', 4: 'EtudEasy', 5: 'Formule 1', 6: 'Tennis', 7: "Retour dans l'espace" };
const label = (n) => (n === 7 ? NAMES[7] : `Univers 0${n} · ${NAMES[n]}`);

/* Formule 1 : feux de départ, puis la voiture traverse l'écran et dévoile le monde */
const f1Intro = document.getElementById('f1-intro');
const f1Reveal = f1Intro.querySelector('.f1-reveal');
const f1Lights = [...f1Intro.querySelectorAll('.f1-lights i')];
const f1Runner = f1Intro.querySelector('.f1-runner');
const f1Label = document.getElementById('f1-label');
async function carWarp(to, from) {
  const speed = reduceMotion ? 0.01 : 1;
  f1Label.textContent = label(to);
  f1Intro.style.visibility = 'visible';
  f1Intro.style.opacity = 0;
  f1Reveal.style.clipPath = 'inset(0 0 0 0)';
  f1Runner.style.transform = 'translateX(-110%)';
  f1Lights.forEach((l) => l.classList.remove('on'));
  f1Label.style.opacity = 1;
  await tween(260 * speed, (k) => { f1Intro.style.opacity = k; });
  landIn(to, from);
  for (const l of f1Lights) { l.classList.add('on'); await pause(150 * speed); }
  await pause(320 * speed);
  f1Lights.forEach((l) => l.classList.remove('on'));
  // La voiture passe : derrière elle, l'écran s'ouvre sur le nouveau monde
  const w = f1Runner.offsetWidth;
  await tween(780 * speed, (k) => {
    const e = k * k * (2.2 - 1.2 * k);
    const x = -w * 1.1 + (innerWidth + w * 2.2) * e;
    f1Runner.style.transform = `translateX(${x}px)`;
    const cut = clamp((x + w * 0.15) / innerWidth) * 100;
    f1Reveal.style.clipPath = `inset(0 0 0 ${cut}%)`;
    f1Label.style.opacity = 1 - clamp(k * 2.5);
    document.querySelector('.f1-lights').style.opacity = 1 - clamp(k * 2.5);
  });
  document.querySelector('.f1-lights').style.opacity = 1;
  f1Intro.style.visibility = 'hidden';
}

/* Tennis : la balle rebondit sur le court, fonce vers l'écran, puis s'efface */
const tnIntro = document.getElementById('tennis-intro');
const tnBall = tnIntro.querySelector('.tn-ball');
const tnShadow = tnIntro.querySelector('.tn-shadow');
const tnLabel = document.getElementById('tn-label');
async function ballWarp(to, from) {
  const speed = reduceMotion ? 0.01 : 1;
  tnLabel.textContent = label(to);
  tnIntro.style.visibility = 'visible';
  tnIntro.style.opacity = 0;
  tnBall.style.opacity = 1;
  const W = innerWidth;
  const H = innerHeight;
  const place = (x, y, h, sc) => {
    tnBall.style.transform = `translate(${x}px, ${y - h}px) scale(${sc}) rotate(${x}deg)`;
    tnShadow.style.transform = `translate(${x}px, ${y + 30 * sc}px) scale(${Math.max(0.3, 1 - h / 400) * sc})`;
    tnShadow.style.opacity = Math.max(0, 1 - h / 500);
  };
  // En portrait le court est vertical : la balle arrive du bas
  const vert = H > W;
  const x0 = vert ? W * 0.32 : -80;
  const y0 = vert ? H + 60 : H * 0.72;
  const x1 = W * 0.5;
  const y1 = vert ? H * 0.58 : H * 0.6;
  place(x0, y0, 260, 1);
  await tween(240 * speed, (k) => { tnIntro.style.opacity = k; });
  landIn(to, from);
  // Deux rebonds sur la terre battue
  await tween(1050 * speed, (k) => {
    const x = lerp(x0, x1, k);
    const y = lerp(y0, y1, k);
    const b = k < 0.55 ? k / 0.55 : (k - 0.55) / 0.45;
    const amp = k < 0.55 ? 300 : 150;
    const h = Math.abs(Math.sin(b * Math.PI)) * amp * (k < 0.55 ? 1 : 1);
    place(x, y, k < 0.08 ? 260 * (1 - k / 0.08) + h : h, 1);
  });
  // Elle fonce vers nous et couvre l'écran
  const big = (Math.hypot(W, H) / 80) * 2.4;
  await tween(520 * speed, (k) => {
    const e = k * k;
    place(x1, lerp(y1, H * 0.5, e), 0, 1 + big * e);
    tnShadow.style.opacity = 1 - k;
  });
  tnIntro.querySelector('.tn-court').style.opacity = 0;
  tnLabel.style.opacity = 0;
  await tween(380 * speed, (k) => { tnBall.style.opacity = 1 - k; });
  tnIntro.querySelector('.tn-court').style.opacity = 1;
  tnLabel.style.opacity = 1;
  tnIntro.style.visibility = 'hidden';
}

/* Fin : saut dans l'hyperespace, puis la Terre */
const lift = document.getElementById('liftoff');
const lc = document.getElementById('liftoff-canvas');
const lctx = lc.getContext('2d');
const loLabel = document.getElementById('lo-label');
let outroK = null;
const OUTRO_SWAP = 0.5;
const endCard = document.querySelector('.end-card');
const outroCap = document.getElementById('outro-cap');
async function spaceWarp(to, from) {
  if (to === LAST) return zoomOutWarp(from);
  return hyperWarp(to, from);
}
// Comme au début, mais à l'envers : on part de Roland-Garros et on recule jusqu'à l'espace
async function zoomOutWarp(from) {
  const speed = reduceMotion ? 0.01 : 1;
  prefetchTiles(RG);
  outroK = 0;
  endCard.style.opacity = 0;
  endCard.style.transform = 'translateY(20px)';
  // Un court fondu au blanc, comme un flash de photo
  lift.style.background = '#fff';
  lc.style.display = 'none';
  loLabel.textContent = '';
  lift.style.visibility = 'visible';
  await tween(220 * speed, (k) => { lift.style.opacity = k; });
  landIn(LAST, from);
  outroCap.querySelector('b').textContent = 'Roland-Garros';
  outroCap.querySelector('span').textContent = 'Paris · 48.85° N, 2.25° E';
  outroCap.style.visibility = 'visible';
  await pause(120 * speed);
  await tween(380 * speed, (k) => { lift.style.opacity = 1 - k; outroCap.style.opacity = k; });
  lift.style.visibility = 'hidden';
  lift.style.background = '';
  lc.style.display = '';
  await tween(4200 * speed, (k) => {
    outroK = k;
    if (k > OUTRO_SWAP && outroCap.querySelector('b').textContent !== "Retour dans l'espace") {
      outroCap.querySelector('b').textContent = "Retour dans l'espace";
      outroCap.querySelector('span').textContent = 'Fin du voyage';
    }
    // Légende : « Roland-Garros » pendant la carte, puis « Retour dans l'espace » sur le globe
    const first = Math.min(range(k, 0, 0.05), 1 - smooth(range(k, OUTRO_SWAP - 0.12, OUTRO_SWAP - 0.04)));
    const second = Math.min(smooth(range(k, OUTRO_SWAP + 0.06, OUTRO_SWAP + 0.14)), 1 - smooth(range(k, 0.86, 1)));
    outroCap.style.opacity = k < OUTRO_SWAP ? first : second;
  });
  outroK = null;
  outroCap.style.visibility = 'hidden';
  endCard.style.transition = 'opacity .6s, transform .6s';
  endCard.style.opacity = 1;
  endCard.style.transform = '';
}
async function hyperWarp(to, from) {
  const speed = reduceMotion ? 0.01 : 1;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  lc.width = innerWidth * dpr;
  lc.height = innerHeight * dpr;
  lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cx = innerWidth / 2;
  const cy = innerHeight / 2;
  const starsW = [...Array(420)].map(() => ({ a: Math.random() * Math.PI * 2, r: Math.random() * 40 + 4, v: Math.random() * 0.8 + 0.4 }));
  loLabel.textContent = to === 7 ? NAMES[7] : label(to);
  lift.style.visibility = 'visible';
  lift.style.opacity = 0;
  let zoom = 0;
  const draw = (k) => {
    lctx.fillStyle = 'rgba(0,0,0,.35)';
    lctx.fillRect(0, 0, innerWidth, innerHeight);
    lctx.strokeStyle = '#fff';
    zoom = k;
    for (const st of starsW) {
      const r0 = st.r * (1 + zoom * 30 * st.v);
      const r1 = r0 * (1 + 0.08 + zoom * 0.5);
      lctx.globalAlpha = Math.min(1, 0.3 + zoom);
      lctx.lineWidth = 1 + zoom * 1.5;
      lctx.beginPath();
      lctx.moveTo(cx + Math.cos(st.a) * r0, cy + Math.sin(st.a) * r0);
      lctx.lineTo(cx + Math.cos(st.a) * r1, cy + Math.sin(st.a) * r1);
      lctx.stroke();
    }
    lctx.globalAlpha = 1;
  };
  await tween(260 * speed, (k) => { lift.style.opacity = k; draw(k * 0.1); });
  landIn(to, from);
  await tween(1100 * speed, (k) => draw(0.1 + ease(k) * 0.9));
  await tween(520 * speed, (k) => { lift.style.opacity = 1 - k; draw(1 - k * 0.5); });
  lift.style.visibility = 'hidden';
}

async function changeWorld(to) {
  warping = true;
  const from = scrollY;
  lockScroll(true);
  const pair = (n) => to === n || world === n;
  if (pair(7)) await spaceWarp(to, from);
  else if (pair(6)) await ballWarp(to, from);
  else if (pair(5)) await carWarp(to, from);
  else if (to === 4 || world === 4) await chalkWarp(to, from);
  else if (to === 3 || world === 3) await doorWarp(to, from);
  else await pixelWarp(to, from);
  lockScroll(false);
  warping = false;
  checkWorld();
}

// On entre dans un monde dès la fin de la page du précédent ;
// on en ressort quand sa section est repassée sous le bas de l'écran.
// Positions des sections mises en cache (lire la mise en page à chaque scroll coûte cher)
const topCache = {};
function cacheTops() { for (const n in WORLD_TOP) topCache[n] = WORLD_TOP[n].offsetTop; }
addEventListener('load', cacheTops);
addEventListener('resize', cacheTops);
setInterval(cacheTops, 3000);
function wantedWorld() {
  if (!topCache[2]) cacheTops();
  for (const n of [7, 6, 5, 4, 3, 2]) {
    const top = topCache[n] - scrollY;
    if (top < innerHeight * (world >= n ? 1.08 : 0.9)) return n;
  }
  return 1;
}
function checkWorld() {
  if (warping) return;
  const w = wantedWorld();
  if (w !== world) changeWorld(w);
}

let bestScore = 0;
function updateArcade() {
  checkWorld();
  if (world !== 2) return;
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

// EtudEasy : un post-it affiche l'écran correspondant sur le téléphone
const ecScreen = document.getElementById('ec-screen');
document.querySelectorAll('.postit').forEach((p) => {
  p.addEventListener('click', () => {
    document.querySelectorAll('.postit').forEach((x) => {
      x.classList.toggle('on', x === p);
      x.setAttribute('aria-selected', x === p);
    });
    ecScreen.style.opacity = 0;
    // Sur mobile le téléphone est au-dessus des post-its : on le ramène à l'écran
    if (matchMedia('(max-width: 900px)').matches) ecScreen.closest('.ec-device').scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => {
      ecScreen.src = `assets/img/etudeasy/${p.dataset.screen}.webp`;
      ecScreen.onload = () => { ecScreen.style.opacity = 1; };
    }, 180);
  });
});
// Précharge les écrans pour un changement instantané
['reveil', 'assistant', 'examens-ia', 'resultats', 'espagnol'].forEach((n) => { new Image().src = `assets/img/etudeasy/${n}.webp`; });

// Les images du premier niveau de la carte autour de Barcelone sont-elles arrivées ?
function baseReady() {
  const l = Math.floor(Z_START) + 1;
  const [cx, cy] = worldPx(l, CN);
  const tx = Math.floor(cx / 256);
  const ty = Math.floor(cy / 256);
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (!getTile(l, tx + dx, ty + dy, 'now')) return false;
  return true;
}

/* ---------- Voyage automatique : un seul scroll suffit pour aller jusqu'au Camp Nou ---------- */
const barca = document.getElementById('barca');
let autoPlaying = false;
const JOURNEY_MS = 7000;
async function autoJourney() {
  autoPlaying = true;
  warping = true;
  lockScroll(true);
  frozen = true;
  if (!prefetched) prefetchTiles();
  pauseBackground = true;
  // Les niveaux de base de la carte passent en priorité pendant la phase « espace » :
  // ils servent de filet de sécurité, pour ne jamais voir un écran noir ensuite
  for (let l = Math.floor(Z_START); l <= Math.floor(Z_START) + 3; l++) {
    const [cx, cy] = worldPx(l, CN);
    const tx = Math.floor(cx / 256);
    const ty = Math.floor(cy / 256);
    for (let dx = -3; dx <= 3; dx++) for (let dy = -2; dy <= 2; dy++) getTile(l, tx + dx, ty + dy, 'now');
  }
  const start = clamp(scrollY / journeyEnd);
  const ms = reduceMotion ? 10 : Math.max(1500, JOURNEY_MS * (1 - start));
  // Démarrage et arrivée en douceur ; si la carte n'est pas prête au passage des nuages,
  // on patiente dans les nuages (2,5 s maximum) plutôt que d'afficher un écran vide
  await new Promise((resolve) => {
    let k = 0;
    let last = performance.now();
    let waited = 0;
    const step = (now) => {
      const dt = Math.min(100, now - last);
      last = now;
      const p = lerp(start, 1, k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
      const atSwap = p > SWITCH - 0.015 && p < SWITCH + 0.01;
      if (atSwap && !baseReady() && waited < 2500) waited += dt;
      else k = Math.min(1, k + dt / ms);
      target = prog = p;
      if (k < 1) requestAnimationFrame(step);
      else { target = prog = 1; resolve(); }
    };
    requestAnimationFrame(step);
  });
  jumpTo(journeyEnd);
  pauseBackground = false;
  pumpImages();
  frozen = false;
  lockScroll(false);
  // On glisse jusqu'aux projets Barça
  const from = scrollY;
  const to = barca.offsetTop + innerHeight * 0.22;
  await tween(reduceMotion ? 10 : 1100, (k) => { window.scrollTo(0, lerp(from, to, ease(k))); readScroll(); });
  warping = false;
  autoPlaying = false;
  autoEnded = performance.now();
}
// Déclenché par le premier geste vers le bas tant qu'on est dans le voyage
let autoEnded = 0;
function wantsAuto() {
  // Pas de relance par l'inertie du geste juste après la fin du voyage
  return !autoPlaying && !warping && world === 1 && !frozen && performance.now() - autoEnded > 1500 && scrollY < journeyEnd * 0.92;
}
addEventListener('wheel', (e) => {
  if (e.deltaY > 4 && wantsAuto()) { e.preventDefault(); autoJourney(); }
}, { passive: false });
let touchY = null;
addEventListener('touchstart', (e) => { touchY = e.touches[0].clientY; }, { passive: true });
addEventListener('touchmove', (e) => {
  if (touchY === null || e.target.closest('.menu')) return;
  if (touchY - e.touches[0].clientY > 12 && wantsAuto()) { e.preventDefault(); touchY = null; autoJourney(); }
}, { passive: false });
addEventListener('keydown', (e) => {
  if (['ArrowDown', 'PageDown', ' ', 'Spacebar'].includes(e.key) && wantsAuto() && !e.target.closest('input, textarea, button, a')) { e.preventDefault(); autoJourney(); }
});

// Menu de navigation (téléphone et petits écrans)
const menuBtn = document.getElementById('menu-btn');
const menu = document.getElementById('menu');
function toggleMenu(open = !menu.classList.contains('open')) {
  menu.classList.toggle('open', open);
  menuBtn.classList.toggle('open', open);
  menuBtn.setAttribute('aria-expanded', open);
}
menuBtn.addEventListener('click', () => toggleMenu());
menu.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => toggleMenu(false)));
addEventListener('scroll', () => { if (menu.classList.contains('open') && !warping) toggleMenu(false); }, { passive: true });

addEventListener('scroll', updateArcade, { passive: true });
addEventListener('resize', setupWipe);
setupWipe();
// Page rechargée au milieu d'un monde : pas d'animation
setWorld(wantedWorld());
updateArcade();

/* ==========================================================
   Démarrage
   ========================================================== */
addEventListener('resize', resize);
addEventListener('scroll', readScroll, { passive: true });
resize();
setTimeout(loadEurope, 600);
// Les images satellite de Barcelone se chargent pendant la lecture de la présentation
setTimeout(() => { if (!prefetched) prefetchTiles(); }, 1500);
// Tout est préparé pendant la lecture de la présentation
setTimeout(loadCatalogne, 900);

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

// Indicateur lu par le script d'enregistrement vidéo (aucun effet pour les visiteurs)
window.__portfolio = { get busy() { return warping || autoPlaying; }, get world() { return world; } };

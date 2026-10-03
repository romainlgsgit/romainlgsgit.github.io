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
  const dive = p < SWITCH ? easeOut(range(p, 0.36, SWITCH)) * 0.9 : (1 - range(p, SWITCH, 0.6)) * 0.4;
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

/* ----------------------------------------------------------
   Scène 2 : Barcelone de nuit et le Camp Nou
   ---------------------------------------------------------- */
const stadium = new THREE.Scene();
const stadCam = new THREE.PerspectiveCamera(50, 1, 0.5, 12000);
const HORIZON = new THREE.Color('#2a1c3c');
stadium.fog = new THREE.FogExp2(HORIZON, 0.00028);

// Ciel en dégradé + étoiles
stadium.add(
  new THREE.Mesh(
    new THREE.SphereGeometry(8000, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec3 vW;
        void main() { vW = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        varying vec3 vW;
        void main() {
          float h = vW.y;
          vec3 top = vec3(0.012, 0.016, 0.05);
          vec3 hor = vec3(0.165, 0.11, 0.235);
          vec3 c = mix(hor, top, smoothstep(0.0, 0.45, h));
          c += vec3(0.4, 0.14, 0.12) * pow(1.0 - abs(h), 14.0) * 0.5;
          gl_FragColor = vec4(c, 1.0);
        }`,
    })
  )
);
stadium.add(starField(1500, 5000, 7000, 1.4, { upperOnly: true }));

stadium.add(new THREE.HemisphereLight(0xe4ebff, 0x1d1a2c, 1.7));
const flood = new THREE.DirectionalLight(0xfff4e6, 1.3);
flood.position.set(0.25, 1, -0.35);
stadium.add(flood);

/* --- Le bol du stade : super-ellipse, 3 anneaux de tribunes --- */
const SE_N = 4;
const A0 = 70, B0 = 52;   // bord intérieur (côté pelouse)
const A1 = 132, B1 = 110; // façade extérieure
const H_TOP = 52;
// t = fraction entre bord intérieur et façade, h = hauteur
const PROFILE = [[0, 1.2], [0.33, 17], [0.335, 21], [0.655, 34], [0.66, 38], [1, H_TOP]];
const TIERS = [[0, 0.33], [0.335, 0.655], [0.66, 1]];

function superEllipse(th, a, b) {
  const c = Math.cos(th);
  const s = Math.sin(th);
  return [a * Math.sign(c) * Math.pow(Math.abs(c), 2 / SE_N), b * Math.sign(s) * Math.pow(Math.abs(s), 2 / SE_N)];
}
function ringPoint(th, t) {
  const [ix, iz] = superEllipse(th, A0, B0);
  const [ox, oz] = superEllipse(th, A1, B1);
  return [lerp(ix, ox, t), lerp(iz, oz, t)];
}

// Paramétrage à abscisse curviligne : la texture ne s'étire pas dans les virages
const SEGS = 480;
const ringParam = (() => {
  const n = 6000;
  const th = [];
  const len = [0];
  let prev = ringPoint(0, 0.5);
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const p = ringPoint(a, 0.5);
    th.push(a);
    if (i > 0) len.push(len[i - 1] + Math.hypot(p[0] - prev[0], p[1] - prev[1]));
    prev = p;
  }
  const perim = len[n];
  const thetas = [];
  let j = 0;
  for (let k = 0; k <= SEGS; k++) {
    const s = (k / SEGS) * perim;
    while (j < n - 1 && len[j + 1] < s) j++;
    const f = (s - len[j]) / (len[j + 1] - len[j] || 1);
    thetas.push(lerp(th[j], th[j + 1], f));
  }
  return { thetas, perim };
})();

function ringGeometry(profile, uvV = true) {
  const rows = profile.length;
  const pos = [];
  const uv = [];
  const idx = [];
  ringParam.thetas.forEach((th, i) => {
    profile.forEach(([t, h], j) => {
      const [x, z] = ringPoint(th, t);
      pos.push(x, h, z);
      uv.push(i / SEGS, uvV ? t : j / (rows - 1));
    });
  });
  for (let i = 0; i < SEGS; i++) {
    for (let j = 0; j < rows - 1; j++) {
      const a = i * rows + j;
      const b = (i + 1) * rows + j;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function standTexture() {
  const W = 4096;
  const H = 1024;
  const [c, g] = makeCanvas(W, H);
  const vy = (v) => H * (1 - v);
  g.fillStyle = '#17171f';
  g.fillRect(0, 0, W, H);

  // Sections de sièges, blaugrana
  const SEC = 92;
  TIERS.forEach(([v0, v1], ti) => {
    const y0 = vy(v1);
    const y1 = vy(v0);
    for (let x = 0, s = 0; x < W; x += SEC, s++) {
      let col;
      if (ti === 0) col = s % 2 ? '#8c0b3e' : '#a1124b';
      else if (ti === 1) col = s % 2 ? '#0b4790' : '#0f53a3';
      else col = s % 6 < 3 ? '#0c4a94' : '#94103f';
      g.fillStyle = col;
      g.fillRect(x + 2, y0, SEC - 4, y1 - y0);
    }
  });

  // « MÉS QUE UN CLUB » sur l'anneau du milieu, tribune sud (u ≈ 0.25)
  const [v0, v1] = TIERS[1];
  const [, h0] = PROFILE[2];
  const [, h1] = PROFILE[3];
  const pxPerMu = W / ringParam.perim;
  const pxPerMv = ((v1 - v0) * H) / Math.hypot((v1 - v0) * (B1 - B0), h1 - h0);
  const sy = pxPerMv / pxPerMu;
  const capM = 0.74 * Math.hypot((v1 - v0) * (B1 - B0), h1 - h0);
  const fontPx = (capM * pxPerMu) / 0.72;
  g.save();
  g.translate(W * 0.25, vy((v0 + v1) / 2));
  g.font = `900 ${fontPx}px Archivo, Impact, 'Arial Black', sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const label = 'MÉS QUE UN CLUB';
  const w = g.measureText(label).width;
  const sx = Math.min(1, (W * 0.2) / w);
  g.scale(sx, sy);
  g.fillStyle = '#f2c200';
  g.fillText(label, 0, fontPx * 0.04);
  g.restore();

  // Rangées de sièges
  g.fillStyle = 'rgba(0,0,0,0.3)';
  TIERS.forEach(([a, b]) => {
    for (let y = vy(b); y < vy(a); y += 5) g.fillRect(0, y, W, 1.6);
  });
  // Escaliers
  g.fillStyle = 'rgba(20,20,28,0.9)';
  for (let x = 0; x < W; x += SEC) g.fillRect(x - 2, 0, 4, H);
  // Coursives
  g.fillStyle = '#121219';
  [[0.33, 0.335], [0.655, 0.66]].forEach(([a, b]) => g.fillRect(0, vy(b) - 3, W, vy(a) - vy(b) + 6));

  // Supporters
  const fans = ['#f2f2f2', '#a50044', '#004d98', '#edbb00', '#e0b49a', '#1a1a1a', '#c8104f', '#2f7cf0'];
  for (let i = 0; i < 70000; i++) {
    g.globalAlpha = rand(0.55, 0.95);
    g.fillStyle = fans[(Math.random() * fans.length) | 0];
    g.fillRect(Math.random() * W, Math.random() * H, 2, 2);
  }
  g.globalAlpha = 1;
  const t = canvasTex(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

const standMat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
stadium.add(new THREE.Mesh(ringGeometry(PROFILE), standMat));

// Façade
stadium.add(
  new THREE.Mesh(
    ringGeometry([[1, 0], [1, H_TOP]], false),
    new THREE.MeshLambertMaterial({ color: 0x272a36, side: THREE.DoubleSide })
  )
);
// Bandeau lumineux en haut de la façade
stadium.add(
  new THREE.Mesh(
    ringGeometry([[1.002, H_TOP - 4], [1.002, H_TOP + 0.5]], false),
    new THREE.MeshBasicMaterial({ color: 0x2f6fd8, side: THREE.DoubleSide })
  )
);
// Toit en couronne
stadium.add(
  new THREE.Mesh(
    ringGeometry([[0.83, 57], [1.04, 59.5]], false),
    new THREE.MeshLambertMaterial({ color: 0x9ea4b6, side: THREE.DoubleSide })
  )
);

// Projecteurs sous le toit
const floodTex = glowTexture();
for (let k = 0; k < 64; k++) {
  const th = ringParam.thetas[Math.round((k / 64) * SEGS)];
  const [x, z] = ringPoint(th, 0.835);
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: floodTex, color: 0xfff1d6, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })
  );
  s.position.set(x, 56, z);
  s.scale.setScalar(13);
  stadium.add(s);
}

// Sol intérieur autour de la pelouse
{
  const shape = new THREE.Shape();
  ringParam.thetas.forEach((th, i) => {
    const [x, z] = ringPoint(th, 0.002);
    if (i === 0) shape.moveTo(x, -z);
    else shape.lineTo(x, -z);
  });
  const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshLambertMaterial({ color: 0x1f4a2a }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.6;
  stadium.add(m);
}

/* --- La pelouse --- */
function pitchTexture() {
  const S = 20; // px par mètre
  const W = 120 * S;
  const H = 80 * S;
  const [c, g] = makeCanvas(W, H);
  const X = (x) => W / 2 + x * S;
  const Z = (z) => H / 2 + z * S;
  const stripe = 105 / 18;
  for (let x = -60; x < 60; x += stripe / 4) {
    const k = Math.floor((x + 52.5) / stripe);
    g.fillStyle = k % 2 ? '#2e7a34' : '#2a6d2f';
    g.fillRect(X(x), 0, (stripe / 4) * S + 1, H);
  }
  for (let i = 0; i < 25000; i++) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${rand(0.02, 0.06)})`;
    g.fillRect(Math.random() * W, Math.random() * H, 3, 3);
  }
  g.strokeStyle = 'rgba(255,255,255,0.92)';
  g.fillStyle = 'rgba(255,255,255,0.92)';
  g.lineWidth = 0.14 * S;
  const rect = (x, z, w, h) => g.strokeRect(X(x), Z(z), w * S, h * S);
  const arc = (x, z, r, a0, a1) => { g.beginPath(); g.arc(X(x), Z(z), r * S, a0, a1); g.stroke(); };
  const dot = (x, z) => { g.beginPath(); g.arc(X(x), Z(z), 0.25 * S, 0, Math.PI * 2); g.fill(); };
  rect(-52.5, -34, 105, 68);
  g.beginPath(); g.moveTo(X(0), Z(-34)); g.lineTo(X(0), Z(34)); g.stroke();
  arc(0, 0, 9.15, 0, Math.PI * 2);
  dot(0, 0);
  const a = Math.acos(5.5 / 9.15);
  for (const s of [-1, 1]) {
    const gx = 52.5 * s;
    rect(s < 0 ? -52.5 : 52.5 - 16.5, -20.16, 16.5, 40.32);
    rect(s < 0 ? -52.5 : 52.5 - 5.5, -9.16, 5.5, 18.32);
    dot(gx - 11 * s, 0);
    if (s < 0) arc(-41.5, 0, 9.15, -a, a);
    else arc(41.5, 0, 9.15, Math.PI - a, Math.PI + a);
    arc(gx, -34, 1, s < 0 ? 0 : Math.PI / 2, s < 0 ? Math.PI / 2 : Math.PI);
    arc(gx, 34, 1, s < 0 ? -Math.PI / 2 : Math.PI, s < 0 ? 0 : Math.PI * 1.5);
  }
  return canvasTex(c);
}
{
  const pitch = new THREE.Mesh(new THREE.PlaneGeometry(120, 80), new THREE.MeshLambertMaterial({ map: pitchTexture() }));
  pitch.rotation.x = -Math.PI / 2;
  pitch.position.y = 0.7;
  stadium.add(pitch);
}

/* --- Les buts --- */
{
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const [nc, ng] = makeCanvas(128, 128);
  ng.strokeStyle = 'rgba(255,255,255,0.55)';
  ng.lineWidth = 2;
  for (let i = 0; i <= 128; i += 16) {
    ng.beginPath(); ng.moveTo(i, 0); ng.lineTo(i, 128); ng.stroke();
    ng.beginPath(); ng.moveTo(0, i); ng.lineTo(128, i); ng.stroke();
  }
  const netTex = canvasTex(nc);
  netTex.wrapS = netTex.wrapT = THREE.RepeatWrapping;
  netTex.repeat.set(12, 4);
  const netMat = new THREE.MeshBasicMaterial({ map: netTex, transparent: true, side: THREE.DoubleSide, depthWrite: false });
  const post = new THREE.CylinderGeometry(0.07, 0.07, 2.44, 10);
  const bar = new THREE.CylinderGeometry(0.07, 0.07, 7.32, 10);
  for (const s of [-1, 1]) {
    const goal = new THREE.Group();
    for (const z of [-3.66, 3.66]) {
      const p = new THREE.Mesh(post, white);
      p.position.set(0, 1.22, z);
      goal.add(p);
    }
    const cb = new THREE.Mesh(bar, white);
    cb.rotation.x = Math.PI / 2;
    cb.position.y = 2.44;
    goal.add(cb);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(7.32, 2.44), netMat);
    back.rotation.y = Math.PI / 2;
    back.position.set(2 * s, 1.22, 0);
    const roof = new THREE.Mesh(new THREE.PlaneGeometry(2, 7.32), netMat);
    roof.rotation.x = -Math.PI / 2;
    roof.position.set(1 * s, 2.44, 0);
    goal.add(back, roof);
    goal.position.set(52.5 * s, 0.7, 0);
    stadium.add(goal);
  }
}

/* --- La ville : grille de l'Eixample, de nuit --- */
const CITY_M = 1600;
const BLOCK = CITY_M / 12;
function cityTexture() {
  const S = 2048;
  const k = S / CITY_M;
  const [c, g] = makeCanvas(S, S);
  g.fillStyle = '#06070c';
  g.fillRect(0, 0, S, S);
  const ch = 14 * k;
  for (let i = 0; i < 12; i++) {
    for (let j = 0; j < 12; j++) {
      const x = (i * BLOCK + 10) * k;
      const y = (j * BLOCK + 10) * k;
      const w = (BLOCK - 20) * k;
      g.fillStyle = '#0d0f17';
      g.beginPath();
      g.moveTo(x + ch, y); g.lineTo(x + w - ch, y); g.lineTo(x + w, y + ch); g.lineTo(x + w, y + w - ch);
      g.lineTo(x + w - ch, y + w); g.lineTo(x + ch, y + w); g.lineTo(x, y + w - ch); g.lineTo(x, y + ch);
      g.closePath();
      g.fill();
      g.fillStyle = '#080910';
      g.fillRect(x + 26 * k, y + 26 * k, w - 52 * k, w - 52 * k);
      for (let n = 0; n < 50; n++) {
        g.fillStyle = `rgba(255,${(rand(190, 235)) | 0},${(rand(120, 200)) | 0},${rand(0.25, 0.8)})`;
        g.fillRect(x + Math.random() * w, y + Math.random() * w, 1.6, 1.6);
      }
    }
  }
  g.globalCompositeOperation = 'lighter';
  g.shadowColor = 'rgba(255,150,60,0.9)';
  g.shadowBlur = 10;
  g.strokeStyle = 'rgba(255,170,85,0.5)';
  g.lineWidth = 2.2;
  for (let i = 0; i <= 12; i++) {
    const p = i * BLOCK * k;
    g.beginPath(); g.moveTo(p, 0); g.lineTo(p, S); g.stroke();
    g.beginPath(); g.moveTo(0, p); g.lineTo(S, p); g.stroke();
  }
  g.lineWidth = 5;
  g.strokeStyle = 'rgba(255,200,120,0.55)';
  g.beginPath(); g.moveTo(0, S); g.lineTo(S, 0); g.stroke();
  g.shadowBlur = 0;
  g.fillStyle = 'rgba(255,220,160,0.9)';
  for (let i = 0; i <= 12; i++) {
    for (let d = 0; d < S; d += 22 * k) {
      g.fillRect(i * BLOCK * k - 1, d, 2, 2);
      g.fillRect(d, i * BLOCK * k - 1, 2, 2);
    }
  }
  const t = canvasTex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 3);
  return t;
}
{
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(CITY_M * 3, CITY_M * 3), new THREE.MeshBasicMaterial({ map: cityTexture() }));
  ground.rotation.x = -Math.PI / 2;
  stadium.add(ground);

  // Esplanade du stade
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(300, 96), new THREE.MeshBasicMaterial({ color: 0x0b0d13 }));
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.y = 0.2;
  stadium.add(plaza);
  const lampTex = glowTexture('rgba(255,235,200,1)', 'rgba(255,170,80,.4)');
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: lampTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    s.position.set(Math.cos(a) * 190, 6, Math.sin(a) * 165);
    s.scale.setScalar(16);
    stadium.add(s);
  }

  // Immeubles en îlots (4 bâtiments par bloc, cour au centre)
  const [wc, wg] = makeCanvas(64, 64);
  wg.fillStyle = '#000';
  wg.fillRect(0, 0, 64, 64);
  for (let x = 0; x < 64; x += 8) {
    for (let y = 0; y < 64; y += 10) {
      if (Math.random() < 0.45) {
        wg.fillStyle = `rgba(255,${(rand(180, 230)) | 0},${(rand(110, 170)) | 0},${rand(0.4, 1)})`;
        wg.fillRect(x + 2, y + 3, 4, 4);
      }
    }
  }
  const winTex = canvasTex(wc);
  winTex.wrapS = winTex.wrapT = THREE.RepeatWrapping;
  winTex.repeat.set(5, 2);
  const side = new THREE.MeshLambertMaterial({ color: 0x14161f, emissive: 0xffffff, emissiveMap: winTex });
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x191b25 });
  const mats = [side, side, roofMat, roofMat, side, side];

  const boxes = [];
  for (let i = -10; i < 10; i++) {
    for (let j = -10; j < 10; j++) {
      const cx = (i + 0.5) * BLOCK;
      const cz = (j + 0.5) * BLOCK;
      const d = Math.hypot(cx, cz * 1.15);
      if (d < 330 || d > 1350) continue;
      if (Math.abs(cx + cz) < BLOCK * 0.75) continue; // la Diagonal
      const h = Math.random() < 0.04 ? rand(45, 80) : rand(16, 30);
      const L = BLOCK - 20;
      const T = 22;
      boxes.push([cx, cz - (L - T) / 2, L, h, T], [cx, cz + (L - T) / 2, L, h * rand(0.85, 1.1), T]);
      boxes.push([cx - (L - T) / 2, cz, T, h * rand(0.85, 1.1), L - 2 * T], [cx + (L - T) / 2, cz, T, h, L - 2 * T]);
    }
  }
  const city = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mats, boxes.length);
  const m = new THREE.Object3D();
  boxes.forEach(([x, z, w, h, dpt], i) => {
    m.position.set(x, h / 2, z);
    m.scale.set(w, h, dpt);
    m.updateMatrix();
    city.setMatrixAt(i, m.matrix);
  });
  stadium.add(city);
}

/* --- Trajectoire de la caméra : de 1 500 m jusqu'à la pelouse --- */
const camPath = new THREE.CatmullRomCurve3(
  [
    new THREE.Vector3(0, 1600, -8),
    new THREE.Vector3(0, 820, -110),
    new THREE.Vector3(0, 400, -230),
    new THREE.Vector3(0, 190, -240),
    new THREE.Vector3(0, 82, -150),
    new THREE.Vector3(0, 26, -72),
    new THREE.Vector3(0, 4.2, -27),
  ],
  false,
  'centripetal'
);
const lookPath = new THREE.CatmullRomCurve3(
  [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, 10),
    new THREE.Vector3(0, 8, 25),
    new THREE.Vector3(0, 14, 45),
    new THREE.Vector3(0, 16, 70),
    new THREE.Vector3(0, 15, 92),
  ],
  false,
  'centripetal'
);

/* ==========================================================
   Rendu
   ========================================================== */
let portrait = false;
function resize() {
  measure();
  readScroll();
  if (!renderer) return;
  const w = innerWidth;
  const h = innerHeight;
  renderer.setSize(w, h, false);
  portrait = w / h < 0.9;
  spaceCam.aspect = stadCam.aspect = w / h;
  spaceCam.fov = portrait ? 55 : 40;
  stadCam.fov = portrait ? 68 : 50;
  spaceCam.updateProjectionMatrix();
  stadCam.updateProjectionMatrix();
}

const tmpPos = new THREE.Vector3();
const tmpLook = new THREE.Vector3();
const tmpDir = new THREE.Vector3();
const UP_Y = new THREE.Vector3(0, 1, 0);
const UP_Z = new THREE.Vector3(0, 0, 1);

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
  stars.rotation.y = t * 0.002;

  const show = range(tE, 0.3, 0.5) * (1 - range(tE, 0.92, 1));
  marker.material.opacity = show;
  marker.scale.setScalar(0.06 * (1 + 0.25 * Math.sin(t * 4)) * lerp(1, 0.25, zoom));
  atmoMat.uniforms.strength.value = lerp(1, 0.35, range(tE, 0.7, 1));

  setAltitude(alt * 6371000);
  renderer.setClearColor(0x000000, 0);
  renderer.render(space, spaceCam);
}

function renderStadium(p, t) {
  const tS = range(p, SWITCH, 0.985);
  const u = 1 - Math.pow(1 - tS, 1.35);
  camPath.getPoint(u, tmpPos);
  lookPath.getPoint(u, tmpLook);

  // Légère spirale pendant la descente
  const ang = (1 - ease(tS)) * 0.9;
  tmpPos.applyAxisAngle(UP_Y, ang);
  tmpLook.applyAxisAngle(UP_Y, ang);
  if (!reduceMotion) tmpPos.y += Math.sin(t * 0.8) * 0.15 * range(tS, 0.8, 1);

  stadCam.position.copy(tmpPos);
  tmpDir.subVectors(tmpLook, tmpPos).normalize();
  const flat = 1 - Math.abs(tmpDir.y);
  stadCam.up.copy(UP_Z).lerp(UP_Y, smooth(clamp(flat * 1.6))).normalize();
  stadCam.lookAt(tmpLook);

  setAltitude(Math.max(0, tmpPos.y - 0.7));
  renderer.setClearColor(0x000000, 1);
  renderer.render(stadium, stadCam);
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
  if (!renderer) return;
  if (scrollY > journeyEnd + innerHeight * 1.2) return; // la section projets couvre tout
  if (prog < SWITCH) renderSpace(prog, t);
  else renderStadium(prog, t);
}

/* ==========================================================
   Démarrage
   ========================================================== */
addEventListener('resize', resize);
addEventListener('scroll', readScroll, { passive: true });
resize();

// Le texte « MÉS QUE UN CLUB » attend la police Archivo
(document.fonts ? document.fonts.load('900 120px Archivo').catch(() => {}) : Promise.resolve()).then(() => {
  standMat.map = standTexture();
  standMat.needsUpdate = true;
});

// Aperçu figé d'une étape (développement) : ?p=0.75
const qp = parseFloat(new URLSearchParams(location.search).get('p'));
if (!Number.isNaN(qp)) {
  frozen = true;
  target = prog = clamp(qp);
  jumpOnce = true;
}

requestAnimationFrame(frame);

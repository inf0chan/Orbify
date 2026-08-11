/**
 * orb.js — NCS-Style Audio-Reactive Particle Orb (v2)
 *
 * TRUE NCS-style behaviour:
 *   - Each of 8 000 particles has its own frequency bin assignment
 *   - Per-particle CPU displacement: particle moves RADIALLY based on ITS OWN frequency value
 *   - Bass bins → equatorial belt → large dramatic spikes
 *   - Mid  bins → mid-latitudes  → medium turbulence
 *   - High bins → polar caps     → dense shimmering
 *   - Color: dark purple base → bright purple → cyan tip → white-hot at extremes
 *   - Additive blending → natural glow without extra post-processing
 *   - Inner core sphere pulses with overall energy
 *   - Orb fills entire canvas (centered)
 */

const OrbVisualizer = (() => {

  // ─── Adaptive particle count ────────────────────────────────────
  // Fewer particles on small / low-DPI screens so phones stay smooth.
  const detectCount = () => {
    const w = window.innerWidth  || 1920;
    const h = window.innerHeight || 1080;
    return Math.min(8000, Math.max(1500, Math.floor((w * h) / 220)));
  };

  // ─── Config ─────────────────────────────────────────────────────
  const CFG = {
    COUNT:           detectCount(),   // Particle count (adaptive)
    BASE_R:          2.6,     // Sphere base radius
    MAX_DISP:        2.2,     // Max radial displacement (spike length)
    BASS_BOOST:      3.0,     // Extra amplitude for bass-mapped particles
    SMOOTH_FAST:     0.25,    // Lerp for particles near their peak (attack)
    SMOOTH_SLOW:     0.08,    // Lerp for particles returning to base (release)
    IDLE_AMP:        0.06,    // Idle oscillation amplitude
    ROT_BASE:        0.0018,  // Base rotation speed (rad/frame)
    ROT_BASS:        0.006,   // Extra rotation per bass unit
    SIZE_BASE_MIN:   1.4,
    SIZE_BASE_MAX:   2.8,
  };

  // ─── Three.js state ─────────────────────────────────────────────
  let renderer, scene, camera, clock;
  let particles, particleGeo;
  let coreMesh, coreGlowMesh;
  let animId;

  // ─── Per-particle CPU state ──────────────────────────────────────
  const origNormals   = new Float32Array(CFG.COUNT * 3); // Unit normals on unit sphere
  const freqBinIdx    = new Int32Array(CFG.COUNT);        // FFT bin for this particle (0-1023)
  const smoothDisp    = new Float32Array(CFG.COUNT);      // Smoothed displacement (0-1)
  const baseSizes     = new Float32Array(CFG.COUNT);      // Base point size

  // ─── GLSL Shaders ───────────────────────────────────────────────
  // Vertex: receives per-particle displacement (0-1), colours and sizes accordingly
  const VERT = `
    attribute float aDisplace; // 0.0 (silent) → 1.0 (peak)
    attribute float aBaseSize;

    varying float vD;  // displacement passed to fragment

    void main() {
      vD = aDisplace;

      // Particle size: grows dramatically at spike tip
      float sz = aBaseSize * (1.0 + aDisplace * 5.0);

      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position  = projectionMatrix * mv;
      gl_PointSize = sz * (380.0 / -mv.z);
    }
  `;

  // Fragment: round soft particle, colour driven by displacement
  const FRAG = `
    varying float vD;

    void main() {
      // Soft disc
      vec2 uv = gl_PointCoord - 0.5;
      float d = length(uv) * 2.0;
      if (d > 1.0) discard;

      // Glow: very bright center, fades out
      float alpha = pow(1.0 - d, 1.6) * (0.55 + vD * 0.45);

      // Colour ramp:
      //   0.0  →  0.25  : dark indigo → deep neon purple
      //   0.25 →  0.55  : deep purple → bright violet
      //   0.55 →  0.80  : bright violet → electric cyan
      //   0.80 →  1.00  : electric cyan → white-hot
      vec3 c0 = vec3(0.10, 0.02, 0.30);  // dark indigo
      vec3 c1 = vec3(0.69, 0.15, 1.00);  // deep neon purple
      vec3 c2 = vec3(0.82, 0.38, 1.00);  // bright violet
      vec3 c3 = vec3(0.00, 0.90, 1.00);  // electric cyan
      vec3 c4 = vec3(1.00, 0.98, 1.00);  // white-hot

      vec3 col;
      if      (vD < 0.25) col = mix(c0, c1, vD / 0.25);
      else if (vD < 0.55) col = mix(c1, c2, (vD - 0.25) / 0.30);
      else if (vD < 0.80) col = mix(c2, c3, (vD - 0.55) / 0.25);
      else                col = mix(c3, c4, (vD - 0.80) / 0.20);

      // Extra bloom: brighten at glow center
      float bloom = pow(1.0 - d, 3.0) * 0.5;
      col = col + bloom * mix(col, vec3(1.0), 0.4);

      gl_FragColor = vec4(col, alpha);
    }
  `;

  // Core glow sphere shaders (additive rim glow)
  const CORE_VERT = `
    varying vec3 vN;
    void main() {
      vN = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;
  const CORE_FRAG = `
    uniform vec3  uColor;
    uniform float uAmp;
    varying vec3  vN;
    void main() {
      // Rim glow
      float rim = pow(1.0 - abs(dot(vN, vec3(0.0,0.0,1.0))), 2.8);
      gl_FragColor = vec4(uColor * rim * uAmp, rim * 0.55);
    }
  `;

  // ─── Build Particles ────────────────────────────────────────────
  function buildParticles() {
    particleGeo = new THREE.BufferGeometry();

    const positions  = new Float32Array(CFG.COUNT * 3);
    const aDisplace  = new Float32Array(CFG.COUNT);
    const aBaseSize  = new Float32Array(CFG.COUNT);

    // Fibonacci lattice for uniform sphere distribution
    const PHI = Math.PI * (3.0 - Math.sqrt(5.0));
    const FREQ_BINS = 1024; // analyser.frequencyBinCount (fftSize 2048)

    for (let i = 0; i < CFG.COUNT; i++) {
      // Fibonacci sphere point
      const yi     = 1.0 - (i / (CFG.COUNT - 1)) * 2.0; // -1 … 1
      const sinY   = Math.sqrt(Math.max(0, 1 - yi * yi));
      const theta  = PHI * i;

      const xi = sinY * Math.cos(theta);
      const zi = sinY * Math.sin(theta);

      // Store unit normal (sphere normal = sphere point for unit sphere)
      origNormals[i*3]   = xi;
      origNormals[i*3+1] = yi;
      origNormals[i*3+2] = zi;

      // Initial position at base radius
      positions[i*3]   = xi * CFG.BASE_R;
      positions[i*3+1] = yi * CFG.BASE_R;
      positions[i*3+2] = zi * CFG.BASE_R;

      // ── Frequency bin mapping ──────────────────────────────────
      // We use AZIMUTHAL angle (phi around Y axis) → maps longitudinal
      // "columns" of the sphere to frequency bins.
      // This creates the NCS effect where different angular sectors
      // spike outward based on different frequency bands.
      //
      // Additionally, latitude (|yi|) biases toward bass or treble:
      //   equatorial (|yi| ≈ 0) → bass range (low bin indices)
      //   polar      (|yi| ≈ 1) → treble range (high bin indices)
      //
      // Final bin = blend of phi-based and latitude-based mapping.

      const phi        = Math.atan2(zi, xi);                        // -PI … PI
      const normPhi    = (phi + Math.PI) / (2 * Math.PI);           // 0 … 1
      const absY       = Math.abs(yi);                               // 0 … 1 (polar)

      // phi drives the primary "column" bin (full frequency range)
      const phiBin     = normPhi * (FREQ_BINS - 1);

      // latitude shifts toward bass (equatorial) or treble (polar)
      //   equatorial: use lower 30% of bins for strong bass spikes
      //   polar:      use upper 50% of bins for shimmer
      const bassRange  = 0.30;  // fraction of bins that are "bass"
      const trebleStart= 0.50;
      const bassBin    = normPhi * bassRange * (FREQ_BINS - 1);
      const trebleBin  = (trebleStart + normPhi * (1 - trebleStart)) * (FREQ_BINS - 1);

      const bassMix    = Math.pow(1.0 - absY, 2.0);  // 1 at equator, 0 at pole
      const trebleMix  = Math.pow(absY, 1.5);         // 1 at pole, 0 at equator
      const midMix     = 1.0 - bassMix - trebleMix;   // middle latitudes

      const rawBin = bassMix * bassBin + trebleMix * trebleBin + midMix * phiBin;
      freqBinIdx[i] = Math.min(FREQ_BINS - 1, Math.max(0, Math.round(rawBin)));

      // Base size: slightly larger for equatorial (bass) particles
      const sizeRange = CFG.SIZE_BASE_MAX - CFG.SIZE_BASE_MIN;
      baseSizes[i]  = CFG.SIZE_BASE_MIN + Math.random() * sizeRange;
      aBaseSize[i]  = baseSizes[i];
      aDisplace[i]  = 0;
    }

    particleGeo.setAttribute('position',  new THREE.BufferAttribute(positions, 3));
    particleGeo.setAttribute('aDisplace', new THREE.BufferAttribute(aDisplace,  1));
    particleGeo.setAttribute('aBaseSize', new THREE.BufferAttribute(aBaseSize,  1));

    const mat = new THREE.ShaderMaterial({
      uniforms:       {},
      vertexShader:   VERT,
      fragmentShader: FRAG,
      transparent:    true,
      blending:       THREE.AdditiveBlending,
      depthWrite:     false,
      depthTest:      false,
    });

    particles = new THREE.Points(particleGeo, mat);
    scene.add(particles);
  }

  // ─── Build Core Glow Sphere ─────────────────────────────────────
  function buildCore() {
    const coreUniforms = {
      uColor: { value: new THREE.Color(0xb026ff) },
      uAmp:   { value: 1.5 },
    };

    const coreMat = new THREE.ShaderMaterial({
      uniforms:       coreUniforms,
      vertexShader:   CORE_VERT,
      fragmentShader: CORE_FRAG,
      transparent:    true,
      blending:       THREE.AdditiveBlending,
      depthWrite:     false,
      side:           THREE.BackSide,
    });

    // Inner core (tight glow)
    coreMesh = new THREE.Mesh(
      new THREE.SphereGeometry(CFG.BASE_R * 0.96, 32, 32),
      coreMat
    );
    scene.add(coreMesh);

    // Outer atmospheric glow
    const glowMat = coreMat.clone();
    glowMat.uniforms = {
      uColor: { value: new THREE.Color(0x00e5ff) },
      uAmp:   { value: 0.55 },
    };
    coreGlowMesh = new THREE.Mesh(
      new THREE.SphereGeometry(CFG.BASE_R * 1.45, 32, 32),
      glowMat
    );
    scene.add(coreGlowMesh);
  }

  // ─── Init ───────────────────────────────────────────────────────
  function init() {
    const canvas = document.getElementById('orb-canvas');
    if (!canvas) return;

    const w = canvas.offsetWidth  || 800;
    const h = canvas.offsetHeight || 600;

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    renderer.setClearColor(0x000000, 0);

    scene  = new THREE.Scene();
    clock  = new THREE.Clock();

    camera = new THREE.PerspectiveCamera(52, w / h, 0.1, 200);
    camera.position.set(0, 0, 9);

    buildParticles();
    buildCore();

    window.addEventListener('resize', onResize);

    animate();
  }

  // ─── Animation Loop ─────────────────────────────────────────────
  function animate() {
    animId = requestAnimationFrame(animate);

    const t       = clock.getElapsedTime();
    const metrics = OrbifyPlayer.getAudioMetrics();   // { bass, mid, high, overall }
    const fData   = OrbifyPlayer.getFrequencyData();  // Uint8Array | null

    const posArr  = particleGeo.attributes.position.array;
    const dispArr = particleGeo.attributes.aDisplace.array;

    // ── Per-particle update ────────────────────────────────────────
    for (let i = 0; i < CFG.COUNT; i++) {
      const nx = origNormals[i*3];
      const ny = origNormals[i*3+1];
      const nz = origNormals[i*3+2];

      // Raw frequency value for this particle's bin (0-1)
      let raw = 0;
      if (fData) {
        raw = fData[freqBinIdx[i]] / 255.0;
      }

      // Equatorial boost: particles near equator get bass-amplified
      const absY     = Math.abs(ny);
      const eqWeight = Math.pow(1.0 - absY, 1.8); // 1 at equator, ~0 at poles
      const boosted  = raw * (1.0 + eqWeight * (CFG.BASS_BOOST - 1.0));
      const clamped  = Math.min(1.0, boosted);

      // Idle oscillation (organic breathing when silent)
      const idle = Math.sin(t * 0.9 + nx * 6.0 + ny * 4.2 + nz * 5.1) * CFG.IDLE_AMP;
      const target = clamped + idle * Math.max(0, 1.0 - metrics.overall * 4.0);

      // Asymmetric smoothing: fast attack, slow release (like a VU meter)
      const lerpRate = target > smoothDisp[i] ? CFG.SMOOTH_FAST : CFG.SMOOTH_SLOW;
      smoothDisp[i] += (target - smoothDisp[i]) * lerpRate;

      // Displacement in world units
      const disp = smoothDisp[i] * CFG.MAX_DISP;

      posArr[i*3]   = nx * (CFG.BASE_R + disp);
      posArr[i*3+1] = ny * (CFG.BASE_R + disp);
      posArr[i*3+2] = nz * (CFG.BASE_R + disp);

      dispArr[i] = smoothDisp[i];
    }

    particleGeo.attributes.position.needsUpdate = true;
    particleGeo.attributes.aDisplace.needsUpdate = true;

    // ── Orb rotation ──────────────────────────────────────────────
    const rotSpeed = CFG.ROT_BASE + metrics.bass * CFG.ROT_BASS;
    particles.rotation.y += rotSpeed;
    // Slow tilt
    particles.rotation.x = Math.sin(t * 0.12) * 0.18;
    particles.rotation.z = Math.cos(t * 0.09) * 0.06;

    // ── Core glow reactivity ──────────────────────────────────────
    if (coreMesh) {
      const scale = 1.0 + metrics.bass * 0.35 + metrics.mid * 0.08;
      coreMesh.scale.setScalar(scale);
      coreMesh.rotation.y = -particles.rotation.y * 0.5;
      coreMesh.material.uniforms.uAmp.value = 1.4 + metrics.bass * 3.0;

      // Color shifts neon purple → cyan with highs
      const c = new THREE.Color();
      c.lerpColors(new THREE.Color(0xb026ff), new THREE.Color(0x00e5ff), metrics.high * 1.6);
      coreMesh.material.uniforms.uColor.value.copy(c);
    }

    if (coreGlowMesh) {
      const gs = 1.0 + metrics.bass * 0.55 + Math.sin(t * 0.7) * 0.025;
      coreGlowMesh.scale.setScalar(gs);
      coreGlowMesh.material.uniforms.uAmp.value = 0.45 + metrics.overall * 1.0;
    }

    renderer.render(scene, camera);
  }

  // ─── Resize ─────────────────────────────────────────────────────
  function onResize() {
    const canvas = document.getElementById('orb-canvas');
    if (!canvas) return;
    const container = canvas.parentElement;
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }

  // ─── Public ─────────────────────────────────────────────────────
  return { init, onResize };

})();

// Init after DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', OrbVisualizer.init);
} else {
  OrbVisualizer.init();
}

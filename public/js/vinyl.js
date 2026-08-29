/**
 * vinyl.js — Top-Down Spinning Vinyl Record Visualizer
 *
 * A single top-down scene: a vinyl record filling the view with a tonearm pivoting
 * over it — just like looking down at a real record player.
 *
 *   PLAYING  the tonearm lowers onto the grooves and the record spins (audio
 *            reactive), with a pulsing light that follows the music.
 *   PAUSED   the tonearm lifts up slightly (as a real tonearm does) and the
 *            record eases to a stop.
 *
 * The record's center label shows the currently-playing song title.
 */

const VinylVisualizer = (() => {

  // ─── Config ─────────────────────────────────────────────────────
  const CFG = {
    RECORD_R: 2.5,     // record radius (world units)
    RECORD_THICK: 0.07,    // disc thickness
    BASE_SPEED: 1.7,     // rotation speed (rad/sec) while playing
    BASS_BOOST: 1.9,     // extra speed per unit of bass energy
    SPIN_LERP: 0.28,    // spin acceleration smoothing
    ARM_LIFT: 0.52,    // tonearm pivot angle when lifted (idle)
  };

  // ─── Three.js state ─────────────────────────────────────────────
  let renderer, scene, camera, clock;
  let animId;

  let recordGroup;      // rotating vinyl (disc + label + rim)
  let labelMesh;
  let labelTexture;
  let highlightRing;
  let lastLabelTitle;   // last song title drawn on the center label
  let turntableGroup;   // record + tonearm, tilted together for a 3D front view
  let tonearmGroup;     // tonearm assembly
  let armPivot;         // inner pivot that lowers / lifts the stylus
  let reactionLight;    // pulsing highlight light

  let currentSpeed = 0; // current angular velocity (lerped toward target)

  // Scratch colors reused each frame (avoids GC churn)
  const LIGHT_A = new THREE.Color(0x00e5ff);
  const LIGHT_B = new THREE.Color(0xff8a5c);
  const LIGHT_SCRATCH = new THREE.Color();

  // ─── Procedural vinyl texture ───────────────────────────────────
  function buildVinylTexture() {
    const size = 1024;
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const ctx = cv.getContext('2d');
    const c = size / 2;

    const base = ctx.createRadialGradient(c, c, size * 0.05, c, c, c);
    base.addColorStop(0, '#08080a');
    base.addColorStop(0.6, '#0c0c0f');
    base.addColorStop(1, '#16161b');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);

    // Concentric grooves (these make the spinning visible)
    for (let i = 0; i < 460; i++) {
      const r = size * 0.30 + i * (size * 0.66 / 460);
      ctx.beginPath();
      ctx.arc(c, c, r, 0, Math.PI * 2);
      ctx.globalAlpha = 0.5 + 0.5 * Math.sin(i * 0.7);
      ctx.lineWidth = 1 + (i % 4 === 0 ? 0.5 : 0);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    for (const rr of [0.34, 0.88, 0.94, 0.985]) {
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(c, c, size * rr / 2, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Diagonal glossy glint
    const glint = ctx.createRadialGradient(c + size * 0.15, c - size * 0.15, size * 0.02,
      c + size * 0.15, c - size * 0.15, size * 0.62);
    glint.addColorStop(0, 'rgba(255,255,255,0.20)');
    glint.addColorStop(0.35, 'rgba(255,255,255,0.05)');
    glint.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glint;
    ctx.beginPath();
    ctx.arc(c, c, c, 0, Math.PI * 2);
    ctx.fill();

    // Film grain
    for (let i = 0; i < 2500; i++) {
      ctx.fillStyle = `rgba(255,255,255,${(Math.random() * 0.08).toFixed(3)})`;
      ctx.fillRect(Math.random() * size, Math.random() * size, 1, 1);
    }

    const tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = 4;
    return tex;
  }

  // ─── Center label texture (shows the playing song title) ────────
  // ─── Red center-labell disc texture (printed on the vinyl) ──────
  // The classic red record label in the middle of the disc, showing the song
  // title printed on the label.
  function buildLabelTexture(title) {
    const size = 512;
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const ctx = cv.getContext('2d');
    const c = size / 2;

    const g = ctx.createRadialGradient(c, c, size * 0.05, c, c, size * 0.48);
    g.addColorStop(0, '#3a0d0d');
    g.addColorStop(0.55, '#7a1a1a');
    g.addColorStop(0.92, '#c0392b');
    g.addColorStop(1, '#d46a4a');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c, c, size * 0.485, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,236,210,0.5)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(c, c, size * 0.42, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(c, c, size * 0.09, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(c, c, size * 0.09, 0, Math.PI * 2);
    ctx.stroke();

    // The playing song title (wrapped to fit the label ring)
    const wrapTitle = (text, maxChars) => {
      if (!text) return [];
      const words = String(text).split(/\s+/).filter(Boolean);
      const lines = [];
      let line = '';
      for (const w of words) {
        if ((line + ' ' + w).trim().length > maxChars) {
          if (line) lines.push(line);
          line = w;
        } else {
          line = (line + ' ' + w).trim();
        }
      }
      if (line) lines.push(line);
      return lines.slice(0, 3);
    };
    const lines = wrapTitle(title, 12);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const lh = size * 0.075;
    let ty = c * 0.62;
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${Math.round(size * 0.06)}px Inter, system-ui, sans-serif`;
    if (lines.length <= 1) {
      ctx.fillText(lines[0] || '—', c, ty);
    } else {
      for (const line of lines) {
        ctx.fillText(line, c, ty);
        ty += lh;
      }
    }

    return new THREE.CanvasTexture(cv);
  }

  // ── Refresh the center label when the playing song changes ──────
  function refreshLabel() {
    const track = OrbifyPlayer.getCurrentTrack();
    const title = (track && track.title) || '';
    if (title === lastLabelTitle) return;
    lastLabelTitle = title;

    labelTexture = buildLabelTexture(title);
    if (labelMesh) {
      labelMesh.material.map = labelTexture;
      labelMesh.material.needsUpdate = true;
    }
  }

  // ─── The record (top-down, filling the view) ────────────────────
  function buildRecord() {
    const R = CFG.RECORD_R;
    const vinTex = buildVinylTexture();
    labelTexture = buildLabelTexture('');
    lastLabelTitle = '';

    recordGroup = new THREE.Group();

    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(R, 96),
      new THREE.MeshStandardMaterial({ map: vinTex, roughness: 0.55, metalness: 0.35, side: THREE.DoubleSide })
    );
    recordGroup.add(disc);

    const rim = new THREE.Mesh(
      new THREE.CylinderGeometry(R, R, CFG.RECORD_THICK, 96),
      new THREE.MeshStandardMaterial({ color: 0x0b0b0e, roughness: 0.8, metalness: 0.2 })
    );
    rim.rotation.x = Math.PI / 2;
    recordGroup.add(rim);

    const underside = new THREE.Mesh(
      new THREE.CircleGeometry(R, 96),
      new THREE.MeshStandardMaterial({ color: 0x0b0b0e, roughness: 0.9, metalness: 0.05 })
    );
    underside.rotation.x = Math.PI;
    underside.position.z = -CFG.RECORD_THICK / 2;
    recordGroup.add(underside);

    // Glossy highlight ring (rotates to catch light — makes the spin visible)
    highlightRing = new THREE.Mesh(
      new THREE.CircleGeometry(R * 0.985, 96),
      new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.10,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
      })
    );
    highlightRing.position.z = 0.02;
    recordGroup.add(highlightRing);

    // Red mini label disc at the center of the vinyl (shows the printed title)
    labelMesh = new THREE.Mesh(
      new THREE.CircleGeometry(R * 0.36, 64),
      new THREE.MeshStandardMaterial({ map: labelTexture, roughness: 0.45, metalness: 0.15, side: THREE.DoubleSide })
    );
    labelMesh.position.z = 0.04;
    recordGroup.add(labelMesh);

    // Spindle
    const spindle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 0.1, 20),
      new THREE.MeshStandardMaterial({ color: 0xcdd3da, roughness: 0.25, metalness: 0.9 })
    );
    spindle.position.z = 0.1;
    recordGroup.add(spindle);

    // Turntable platter beneath the disc — this is what makes the scene read as a
    // real vinyl record playing on a turntable rather than a lone floating disc.
    // It sits just below the vinyl, slightly larger, with a subtle metallic rim.
    const platter = new THREE.Mesh(
      new THREE.CircleGeometry(R * 1.08, 96),
      new THREE.MeshStandardMaterial({
        color: 0x1b1b22, roughness: 0.5, metalness: 0.7, side: THREE.DoubleSide,
      })
    );
    platter.position.z = -0.03;
    recordGroup.add(platter);

    const platterRim = new THREE.Mesh(
      new THREE.CylinderGeometry(R * 1.08, R * 1.08, 0.1, 96),
      new THREE.MeshStandardMaterial({ color: 0x2a2a33, roughness: 0.4, metalness: 0.8 })
    );
    platterRim.rotation.x = Math.PI / 2;
    platterRim.position.z = -0.08;
    recordGroup.add(platterRim);

    scene.add(recordGroup);
  }

  // ─── The tonearm (a classic gramophone arm) ─────────────────────
  // A long, gently-curved metal tonearm pivoting at the BACK of the record and
  // sweeping forward over the disc to a headshell whose stylus rests in the
  // grooves — the iconic vintage-gramophone look. The arm lives at a height above
  // the disc (Z = out of the disc) and the whole arm pivots around the X axis so
  // it can lift its stylus cleanly up off the record (no sideways swing, no gap).
  function buildTonearm() {
    const R = CFG.RECORD_R;
    const ARM_H = 0.9;   // height of the arm above the disc face (z=0)
    const PIVOT = R * 1.18;

    const BRASS = new THREE.MeshStandardMaterial({
      color: 0xd8b063, roughness: 0.28, metalness: 0.95,
    });
    const NICKEL = new THREE.MeshStandardMaterial({
      color: 0xcdd3da, roughness: 0.22, metalness: 0.98,
    });

    // Pivot at the back of the platter on the disc plane (z=0).
    tonearmGroup = new THREE.Group();
    tonearmGroup.position.set(0, PIVOT, 0);

    // The arm lifts/lowers by rotating around the X axis (in the disc plane),
    // so the far end tips up/down over the record — the far end is offset along
    // -Y so a rotation about X raises/lowers its Z cleanly.
    armPivot = new THREE.Group();
    armPivot.position.z = ARM_H;
    tonearmGroup.add(armPivot);

    // ---- A single straight metal tube running from the pivot out over the disc,
    // like a real gramophone tonearm. Local frame: +Y = toward the center, +X
    // across, +Z up (the arm rides at height ARM_H above the disc face).
    const ARM_TOE_X = -0.52; // tube endpoint (in the groove zone)
    const ARM_TOE_Y = -2.05;
    const armLine = new THREE.LineCurve3(
      new THREE.Vector3(0, 0.06, 0),
      new THREE.Vector3(ARM_TOE_X, ARM_TOE_Y, 0)
    );

    const armTube = new THREE.Mesh(
      new THREE.TubeGeometry(armLine, 2, 0.055, 16, false),
      BRASS
    );
    armPivot.add(armTube);

    // Square counterweight block at the pivot end of the rod (matte black, no shine)
    const BALL_MAT = new THREE.MeshStandardMaterial({
      color: 0x0a0a0a, roughness: 0.92, metalness: 0.0,
    });
    const ballWeight = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.42, 0.42),
      BALL_MAT
    );
    ballWeight.position.set(0, 0.06, 0);
    armPivot.add(ballWeight);

    // Spherical socket at the end of the rod — the pin holds into this ball joint.
    const socket = new THREE.Mesh(
      new THREE.SphereGeometry(0.075, 20, 16),
      BRASS
    );
    socket.position.set(ARM_TOE_X, ARM_TOE_Y, 0);
    armPivot.add(socket);

    // ---- Stylus PIN: a single sharp needle held by the socket ball at the end of
    // the tube, at a perfect 90° to the rod, pointing straight down onto the
    // groove (z = 0, the disc face). Classic gramophone arm ending — a pin in the
    // groove.
    const stylusPin = new THREE.Mesh(
      new THREE.ConeGeometry(0.018, 0.6, 10),
      NICKEL
    );
    stylusPin.rotation.x = -Math.PI / 2; // cone axis +Y → -Z: straight down
    stylusPin.position.set(ARM_TOE_X, ARM_TOE_Y, -0.3);
    armPivot.add(stylusPin);

    // Sweep the arm toward the upper grooves of the disc.
    tonearmGroup.rotation.z = 0.22;

    // Resting on the grooves by default (no lift). When playing the stylus is in
    // contact; when paused it lifts cleanly off.
    armPivot.rotation.x = 0;

    scene.add(tonearmGroup);
  }

  // ─── Init ───────────────────────────────────────────────────────
  function init() {
    const canvas = document.getElementById('vinyl-canvas');
    if (!canvas) return;

    const w = canvas.offsetWidth || 800;
    const h = canvas.offsetHeight || 600;

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    renderer.setClearColor(0x000000, 0);

    scene = new THREE.Scene();
    clock = new THREE.Clock();

    // Front view of the record; the whole assembly is tilted slightly back
    // (toward its bottom) so it reads as a 3D disc with the rim visible.
    camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 200);
    camera.position.set(0, 0, 8.6);
    camera.lookAt(0, 0, 0);

    // Lighting from high above so the flat record is lit cleanly
    const ambient = new THREE.AmbientLight(0xffffff, 0.45);
    scene.add(ambient);

    const key = new THREE.DirectionalLight(0xffe6c8, 1.05);
    key.position.set(2, 3, 5.5);
    scene.add(key);

    const fill = new THREE.DirectionalLight(0xbfe6ff, 0.3);
    fill.position.set(-3, -1, 2.5);
    scene.add(fill);

    const rim = new THREE.DirectionalLight(0x7a1fd6, 0.35);
    rim.position.set(-3, 2, -4);
    scene.add(rim);

    reactionLight = new THREE.PointLight(0x00e5ff, 0.0, 7);
    reactionLight.position.set(1.2, 1.4, 2.2);
    scene.add(reactionLight);

    buildRecord();
    buildTonearm();

    // Group the record and tonearm together, then tilt the assembly into a
    // natural turntable 3/4 view: lean the disc back a little so the rim and
    // platter read as 3D, and swing the -x edge toward the viewer.
    turntableGroup = new THREE.Group();
    turntableGroup.rotation.x = -0.8;   // tilt the front further up toward the viewer
    turntableGroup.rotation.z = 0.5;    // turn so the -x edge tilts toward the viewer
    turntableGroup.add(recordGroup);

    // The tonearm is a child of the same tilted group, so it already shares the
    // record's tilt and stays parallel to the disc surface.
    turntableGroup.add(tonearmGroup);
    scene.add(turntableGroup);

    window.addEventListener('resize', onResize);
    animate();
  }

  // ─── Animation Loop ─────────────────────────────────────────────
  function animate() {
    animId = requestAnimationFrame(animate);
    const dt = Math.min(0.05, clock.getDelta());
    const t = clock.elapsedTime;

    const metrics = OrbifyPlayer.getAudioMetrics();
    const isPlaying = OrbifyPlayer.getIsPlaying();

    // Keep the center label in sync with the playing song
    refreshLabel();

    // ── Spin the record (eases to stop when paused) ──
    const targetSpeed = isPlaying ? CFG.BASE_SPEED + metrics.bass * CFG.BASS_BOOST : 0;
    currentSpeed += (targetSpeed - currentSpeed) * Math.min(1, CFG.SPIN_LERP * 60 * dt);
    recordGroup.rotation.z += currentSpeed * dt;

    // Groove shimmer
    if (highlightRing) {
      highlightRing.rotation.z = -recordGroup.rotation.z * 0.5;
      highlightRing.material.opacity = 0.05 + metrics.overall * 0.14;
    }

    // ── Tonearm: rest on the grooves when playing, lift when idle ──
    // Lifting rotates the arm around its X axis so the stylus rises cleanly off
    // the disc (no sideways swing and no gap between stylus and vinyl).
    if (armPivot) {
      const targetAngle = isPlaying ? 0 : -CFG.ARM_LIFT;
      const ease = 1 - Math.pow(0.003, dt);
      armPivot.rotation.x += (targetAngle - armPivot.rotation.x) * ease;
      // tiny beat-reactive bounce while tracking the grooves
      if (isPlaying) armPivot.rotation.x -= Math.sin(t * 9) * 0.003 * metrics.overall;
    }

    // ── Pulsing reaction light ──
    if (reactionLight) {
      reactionLight.intensity = metrics.bass * 2.6 + metrics.mid * 0.6;
      LIGHT_SCRATCH.lerpColors(LIGHT_A, LIGHT_B, Math.min(1, metrics.high * 1.8));
      reactionLight.color.copy(LIGHT_SCRATCH);
    }

    renderer.render(scene, camera);
  }

  // ─── Resize ─────────────────────────────────────────────────────
  function onResize() {
    const canvas = document.getElementById('vinyl-canvas');
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
  document.addEventListener('DOMContentLoaded', VinylVisualizer.init);
} else {
  VinylVisualizer.init();
}

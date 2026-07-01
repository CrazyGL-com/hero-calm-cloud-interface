import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import * as React from 'react';
import CrazyGLWrapper, { useContent, useHeroAnimationFrame, useHeroReady, useStableSeed, createDeterministicRandom, } from '@crazygl/core';
import metadata from './metadata.json';
import './style.css';
/* ─────────────────────────────────────────────────────────────────────────
   Calm Cloud Interface — a SaaS dashboard floats among soft cloud sprites
   under a friendly sky. Calm, approachable, effortless.

   PHYSICS / TECHNIQUE
   ───────────────────
   1. Sky — a far PlaneGeometry behind the scene with a custom ShaderMaterial
      that blends a soft-blue top into a cream bottom. Light vignette toward
      the corners keeps the heading copy contrast safe. The plane is rendered
      first (renderOrder = -1000), depthWrite/depthTest off; everything else
      sits in front of it.

   2. Clouds — canvas-painted radial puffs modulated by 3-octave FBM noise
      for a wispy alpha. Each cloud is a Sprite (or PlaneGeometry with a
      basic transparent material) at a depth z in [-8, -2], laid out at
      stable horizontal phases derived from the deterministic seed. The
      cloud layer drifts leftward at a long-cycle speed; closer clouds
      drift faster (parallax). Pointer parallax shifts each cloud in X+Y
      with strength inversely proportional to its depth — deeper clouds
      barely move, near clouds glide.

   3. Foreground screenshot — a PlaneGeometry sized to the loaded image
      aspect, MeshBasicMaterial (we want the screenshot to read like a
      glowing display, not a lit object), with a gentle pitch (screenshotTilt)
      and X/Y offset.

   4. Lighting — a HemisphereLight (sky-blue top, cream bottom) plus a
      warm-white DirectionalLight from above. The screenshot material is
      BasicMaterial so lights mostly shape any future opaque additions; the
      hemisphere mostly gives the scene the right ambient color cast.

   5. Cursor camera drift — the pointer drives camera position by up to
      pointerCameraDrift world units in X and Y, smoothed with a ~180ms
      time constant. We do NOT change camera.lookAt; we shift camera.position
      and let the static lookAt produce a gentle parallax around the
      composition centre.

   COORDINATE SPACES
   ─────────────────
     world       — three.js world; screenshot centred near origin, clouds
                   distributed at z in [-8, -2].
     screenUV    — [0..1]² mapped to the screen plane PlaneGeometry default
                   UVs (origin = bottom-left, V up).
     input       — runtime.input in [0..1]² with top-left origin. Y is
                   FLIPPED when we drive camera.y (input.y=0 at top of canvas
                   → camera moves UP).
   ───────────────────────────────────────────────────────────────────────── */
function parseHex(hex) {
    const h = (hex || '#ffffff').replace('#', '');
    const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const n = parseInt(f, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
/* Build a photographic-looking cloud sprite onto a canvas.

   APPROACH
   ────────
   The earlier version multiplied a single FBM by an elliptical radial mask,
   which read as a fluffy blob. This rewrite leans on four ideas to push it
   toward "photo of a cloud":

   (1) Multi-octave (4 oct) FBM with non-linear hash → no fract(sin) banding,
       no diagonal axis bias.
   (2) Domain warping — the alpha noise is sampled at a position which is
       itself perturbed by a second FBM. This is the standard trick that
       turns blob noise into the lumpy, billowing silhouettes of real
       cumulus.
   (3) A SOFT radial mask combined with the warped FBM via a smoothstep so
       the edges of the cloud feather into the sky over a wide range,
       rather than terminating at a hard ellipse boundary.
   (4) Internal density shading: a separate 3-octave FBM modulates RGB
       brightness so the cloud has bright "billows" and slightly darker
       crevasses, plus a sun-from-above AO term (lower part of the cloud
       darker, top edge brighter) and a warm-top / cool-bottom tint
       gradient — exactly the gradient daylight clouds show.

   Each call returns a fresh canvas; the caller varies "seed" and dims for
   per-cloud variation.
*/
function buildCloudCanvas(W, H, seed, tintRGB) {
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d');
    if (!ctx)
        return cv;
    // Deterministic integer hash → [0,1). Multi-step xorshift-style mix so
    // we don't get the diagonal striping that fract(sin(dot(...))) produces.
    function hash2(ix, iy, s) {
        let n = (ix | 0) * 374761393 + (iy | 0) * 668265263 + (s | 0) * 1103515245;
        n = (n ^ (n >>> 13)) >>> 0;
        n = Math.imul(n, 1274126177) >>> 0;
        n = (n ^ (n >>> 16)) >>> 0;
        return (n & 0xffff) / 0xffff;
    }
    // Quintic-smoothed value noise — smoother derivative than the cubic
    // fade and visibly less grid-aligned at the chosen scales.
    function vnoise(x, y, s) {
        const x0 = Math.floor(x), y0 = Math.floor(y);
        const fx = x - x0, fy = y - y0;
        const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
        const sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
        const a = hash2(x0, y0, s), b = hash2(x0 + 1, y0, s);
        const c = hash2(x0, y0 + 1, s), d = hash2(x0 + 1, y0 + 1, s);
        const ab = a + (b - a) * sx;
        const cd = c + (d - c) * sx;
        return ab + (cd - ab) * sy;
    }
    // 4-octave FBM with non-integer lacunarity to avoid octave grid alignment.
    function fbm4(x, y, s) {
        let amp = 0.5, freq = 1.0, sum = 0, norm = 0;
        for (let o = 0; o < 4; o++) {
            sum += amp * vnoise(x * freq, y * freq, s + o * 31);
            norm += amp;
            amp *= 0.5;
            freq *= 2.07; // not exactly 2 → avoids axis-aligned echoes
        }
        return sum / norm; // 0..1
    }
    // 3-octave FBM for the cheaper density / warp fields.
    function fbm3(x, y, s) {
        let amp = 0.5, freq = 1.0, sum = 0, norm = 0;
        for (let o = 0; o < 3; o++) {
            sum += amp * vnoise(x * freq, y * freq, s + o * 17);
            norm += amp;
            amp *= 0.5;
            freq *= 2.03;
        }
        return sum / norm;
    }
    const img = ctx.createImageData(W, H);
    const cx = W * 0.5, cy = H * 0.5;
    // Cloud body wider than tall (typical cumulus silhouette). These are
    // the radii of the underlying *soft* elliptical mask, kept generous so
    // the FBM-driven detail bleeds out past the mask edge as wisps.
    const rx = W * 0.44;
    const ry = H * 0.36;
    const tintR = tintRGB[0];
    const tintG = tintRGB[1];
    const tintB = tintRGB[2];
    // Warm / cool tint deltas. Subtle — about 6% warm at the top, 8% cool
    // at the bottom, matching what real clouds do under a daylight sky.
    const warmR = 0.06, warmG = 0.03, warmB = -0.02;
    const coolR = -0.05, coolG = -0.02, coolB = 0.06;
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const dx = (x - cx) / rx;
            const dy = (y - cy) / ry;
            const d = Math.sqrt(dx * dx + dy * dy);
            // Soft elliptical mask. Wide feather: 1.0 at centre, 0 by d ≈ 1.25.
            // We DON'T clamp this hard — the FBM below will erode the edge
            // into wisps.
            const radial = Math.max(0, 1 - d / 1.25);
            const radialSoft = radial * radial * (3 - 2 * radial); // smoothstep
            // Domain-warp coordinates: perturb (u,v) by a low-freq FBM before
            // sampling the silhouette FBM. This gives the lumpy, billowing
            // look real cumulus has (vs. the smooth-blob look of plain noise).
            const u = (x / W) * 2.6;
            const v = (y / H) * 2.6;
            const warpScale = 0.85;
            const wx = (fbm3(u * 0.7, v * 0.7, seed + 41) - 0.5) * warpScale;
            const wy = (fbm3(u * 0.7 + 11.3, v * 0.7 + 7.1, seed + 73) - 0.5) * warpScale;
            // Silhouette noise: 4-octave FBM at the warped coords. Bias upward
            // so the cloud has body in the middle.
            const nSil = fbm4(u + wx, v + wy, seed); // 0..1
            // Combine silhouette FBM with the soft radial mask. The product
            // is then run through smoothstep to feather the alpha edge. This
            // is the key step: it gives the cloud a fluffy, indistinct edge
            // that gradients out, instead of a sharp silhouette.
            let core = radialSoft * (0.35 + 0.85 * nSil);
            // Push the upper half of the cloud (top billows) a touch fuller,
            // bottom a touch lower — matches the flatter cumulus base shape.
            const verticalShape = 1.0 - 0.18 * Math.max(0, dy);
            core *= verticalShape;
            // Feather edge: smoothstep over a wide range so the wisps don't
            // terminate at a hard contour.
            const alphaT = smoothstep01(0.05, 0.55, core);
            // Soft halo: keep a low-amplitude tail of alpha outside the body
            // to suggest cloud particles diffusing into the sky.
            const halo = Math.max(0, radialSoft * 0.18 * nSil);
            let a = Math.min(1, alphaT + halo * (1 - alphaT));
            // Internal density variation — separate FBM at a slightly higher
            // frequency, used to modulate brightness only (NOT alpha), so the
            // inside of the cloud has bright billows and darker crevasses.
            const densN = fbm3(u * 1.6 + 19.2, v * 1.6 + 5.7, seed + 113);
            // Map density 0..1 → brightness 0.88..1.06.
            const density = 0.88 + densN * 0.18;
            // Ambient-occlusion / sun-from-above: top of the cloud catches
            // light, bottom is shaded. Use the local vertical position within
            // the cloud (dy in roughly [-1,+1]). Top → +0.06 brighter, bottom
            // → up to 0.22 darker.
            //   dy < 0 → upper half (sunlit)
            //   dy > 0 → lower half (shadowed underside)
            const vert = Math.max(-1, Math.min(1, dy));
            const aoTop = 1.0 + 0.06 * Math.max(0, -vert);
            const aoBot = 1.0 - 0.22 * Math.max(0, vert);
            const ao = aoTop * aoBot;
            // Warm-cool tint gradient: warm at the top, cool at the bottom.
            // tWC = 0 at bottom, 1 at top.
            const tWC = 0.5 - 0.5 * vert;
            const tintDR = coolR + (warmR - coolR) * tWC;
            const tintDG = coolG + (warmG - coolG) * tWC;
            const tintDB = coolB + (warmB - coolB) * tWC;
            // Combine: base tint * density * AO + warm/cool offset.
            const shade = density * ao;
            let r = tintR * shade + tintDR * 0.6;
            let g = tintG * shade + tintDG * 0.6;
            let b = tintB * shade + tintDB * 0.6;
            r = Math.max(0, Math.min(1, r));
            g = Math.max(0, Math.min(1, g));
            b = Math.max(0, Math.min(1, b));
            const px = (y * W + x) * 4;
            img.data[px + 0] = (r * 255) | 0;
            img.data[px + 1] = (g * 255) | 0;
            img.data[px + 2] = (b * 255) | 0;
            img.data[px + 3] = Math.max(0, Math.min(255, a * 255)) | 0;
        }
    }
    ctx.putImageData(img, 0, 0);
    return cv;
}
function smoothstep01(edge0, edge1, v) {
    const t = Math.max(0, Math.min(1, (v - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
}
function CalmCloudHero(props) {
    const { size, input, reducedMotion, seed: rawSeed, screenshot = 'https://crazygl.com/samples/screenshot-dashboard-light.avif', screenshotScale = 1, screenshotX = 0, screenshotY = 0, screenshotTilt = -4, cloudCount = 8, cloudColor = '#ffffff', cloudOpacity = 0.7, cloudDriftSpeed = 0.5, cloudSpeed = 1.5, skyTop = '#b8d8f5', skyBottom = '#fff5e8', pointerCameraDrift = 0.7, pointerParallax = 0.4, transparentBackground = false, } = props;
    const content = useContent(props);
    const stableSeed = useStableSeed(rawSeed ?? 'calm-cloud-interface');
    const [assetsReady, setAssetsReady] = React.useState(false);
    useHeroReady(props, { until: assetsReady });
    const canvasRef = React.useRef(null);
    const [threeReady, setThreeReady] = React.useState(false);
    // Kick the three.js module download off as early as possible (on first
    // render) so its evaluation overlaps the screenshot fetch below instead of
    // happening strictly after the init effect mounts.
    const threeModuleRef = React.useRef(null);
    if (!threeModuleRef.current) {
        threeModuleRef.current = import('three').catch((err) => {
            console.error('[calm-cloud-interface] failed to load three:', err);
            return null;
        });
    }
    // Live props ref. Init runs once; closure-captured props would otherwise
    // be stale on slider changes.
    const propsRef = React.useRef({
        screenshotScale,
        screenshotX,
        screenshotY,
        screenshotTilt,
        cloudOpacity,
        cloudDriftSpeed,
        cloudSpeed,
        pointerCameraDrift,
        pointerParallax,
    });
    propsRef.current.screenshotScale = screenshotScale;
    propsRef.current.screenshotX = screenshotX;
    propsRef.current.screenshotY = screenshotY;
    propsRef.current.screenshotTilt = screenshotTilt;
    propsRef.current.cloudOpacity = cloudOpacity;
    propsRef.current.cloudDriftSpeed = cloudDriftSpeed;
    propsRef.current.cloudSpeed = cloudSpeed;
    propsRef.current.pointerCameraDrift = pointerCameraDrift;
    propsRef.current.pointerParallax = pointerParallax;
    const stateRef = React.useRef({
        ready: false,
        THREE: null,
        renderer: null,
        scene: null,
        camera: null,
        // Sky bg.
        skyMesh: null,
        skyMat: null,
        // Clouds.
        cloudGroup: null,
        clouds: [], // { mesh, baseX, baseY, z, speedFactor, parallaxFactor, halfW, halfH, texture, material }
        cloudColorKey: '',
        lastCloudCount: -1,
        // Screenshot plane.
        screenGroup: null, // outer group (carries X/Y offset)
        screenMesh: null,
        screenMat: null,
        screenshotTex: null,
        screenshotKey: '',
        screenshotAspect: 16 / 9,
        // Cursor camera drift (smoothed).
        camTargetX: 0,
        camTargetY: 0,
        camX: 0,
        camY: 0,
        // Long-cycle drift phase. We accumulate elapsed * cloudDriftSpeed so
        // the visual phase does not jump when the slider changes (we add
        // "Δelapsed × speed" each frame).
        driftPhase: 0,
    });
    /* ── One-shot Three.js init ──────────────────────────────────────── */
    React.useEffect(() => {
        let cancelled = false;
        const canvas = canvasRef.current;
        if (!canvas)
            return;
        (async () => {
            const THREE = await threeModuleRef.current;
            if (cancelled || !THREE)
                return;
            const state = stateRef.current;
            state.THREE = THREE;
            const renderer = new THREE.WebGLRenderer({
                canvas,
                antialias: true,
                alpha: true,
                premultipliedAlpha: false,
                powerPreference: 'high-performance',
            });
            renderer.outputColorSpace = THREE.SRGBColorSpace;
            renderer.toneMapping = THREE.NoToneMapping;
            renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
            state.renderer = renderer;
            const scene = new THREE.Scene();
            scene.background = null;
            state.scene = scene;
            // 35° fov, slight downward look; visible centroid of the
            // screenshot (at world y=0) lands at the canvas vertical midline
            // where <crazygl-content> places its heading.
            const camera = new THREE.PerspectiveCamera(35, 16 / 9, 0.05, 60);
            camera.position.set(0, 0, 5.5);
            camera.lookAt(0, 0, 0);
            state.camera = camera;
            // Sky bg shader. Coordinate spaces commented inline.
            const skyMat = new THREE.ShaderMaterial({
                uniforms: {
                    u_top: { value: new THREE.Color(skyTop) },
                    u_bottom: { value: new THREE.Color(skyBottom) },
                },
                vertexShader: 'varying vec2 vUv;\n' +
                    'void main(){\n' +
                    '  vUv = uv;\n' +
                    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);\n' +
                    '}',
                fragmentShader: 
                // Coordinate spaces in this shader:
                //   vUv     - sky plane local 0..1 (origin bottom-left, V up).
                //             V=1 is the top of the sky, V=0 the bottom horizon.
                //   centred - vUv - 0.5, used for a soft corner vignette.
                'precision highp float;\n' +
                    'varying vec2 vUv;\n' +
                    'uniform vec3 u_top;\n' +
                    'uniform vec3 u_bottom;\n' +
                    'void main(){\n' +
                    '  float t = clamp(vUv.y, 0.0, 1.0);\n' +
                    // Ease the gradient so the warm cream fades up slowly and
                    // the blue dominates the upper half.
                    '  float k = smoothstep(0.05, 0.95, t);\n' +
                    '  vec3 col = mix(u_bottom, u_top, k);\n' +
                    '  vec2 c = vUv - 0.5;\n' +
                    '  float v = 1.0 - smoothstep(0.5, 1.0, length(c) * 1.3);\n' +
                    '  col *= mix(0.86, 1.0, v);\n' +
                    '  gl_FragColor = vec4(col, 1.0);\n' +
                    '}',
                depthWrite: false,
                depthTest: false,
                side: THREE.DoubleSide,
            });
            const skyGeom = new THREE.PlaneGeometry(80, 50);
            const skyMesh = new THREE.Mesh(skyGeom, skyMat);
            skyMesh.position.set(0, 0, -20);
            skyMesh.renderOrder = -1000;
            scene.add(skyMesh);
            state.skyMesh = skyMesh;
            state.skyMat = skyMat;
            // Cloud group sits between the sky and the screenshot.
            const cloudGroup = new THREE.Group();
            scene.add(cloudGroup);
            state.cloudGroup = cloudGroup;
            // Lights.
            const hemi = new THREE.HemisphereLight(0xb8d8f5, 0xfff5e8, 0.65);
            scene.add(hemi);
            state.hemi = hemi;
            const sun = new THREE.DirectionalLight(0xfffaf0, 0.85);
            sun.position.set(2.5, 4.0, 3.0);
            scene.add(sun);
            state.sun = sun;
            // Foreground screenshot — outer group for X/Y offset, inner mesh
            // for tilt (so X/Y offset is unaffected by the tilt rotation).
            const screenGroup = new THREE.Group();
            scene.add(screenGroup);
            state.screenGroup = screenGroup;
            const screenMat = new THREE.MeshBasicMaterial({
                color: new THREE.Color(0.92, 0.92, 0.93),
                toneMapped: false,
                transparent: false,
                side: THREE.DoubleSide,
            });
            const screenMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), screenMat);
            screenGroup.add(screenMesh);
            state.screenMesh = screenMesh;
            state.screenMat = screenMat;
            rebuildClouds();
            applyScreenLayout();
            state.ready = true;
            setThreeReady(true);
            function rebuildClouds() {
                // Tear down existing clouds.
                for (const c of state.clouds) {
                    try {
                        cloudGroup.remove(c.mesh);
                    }
                    catch { }
                    try {
                        c.mesh.geometry?.dispose?.();
                    }
                    catch { }
                    try {
                        c.material?.dispose?.();
                    }
                    catch { }
                    try {
                        c.texture?.dispose?.();
                    }
                    catch { }
                }
                state.clouds = [];
                const count = Math.max(4, Math.min(14, Math.round(cloudCount)));
                state.lastCloudCount = count;
                const tint = parseHex(cloudColor);
                state.cloudColorKey = `${cloudColor}|${count}|${stableSeed}`;
                const rand = createDeterministicRandom(`${stableSeed}|clouds|${count}|${cloudColor}`).next;
                // Width of the band each cloud roams horizontally. World units.
                // We lay them in a wider band than the visible frame so the
                // edges of the band don't pop into view when they wrap.
                const bandHalfW = 14;
                const bandHalfH = 4.5;
                for (let i = 0; i < count; i++) {
                    // Stable depth in [-8, -2]. We bias the distribution so
                    // roughly half the clouds sit BEHIND the screenshot
                    // (z <= -3) and half sit in between the screenshot and
                    // camera-ish range (z in (-3, -2]). The screenshot lives
                    // at z = 0; anything with z < 0 renders behind it.
                    const tDepth = rand();
                    const z = -8 + tDepth * 6; // [-8, -2]
                    // Horizontal start phase — spread evenly with a small
                    // random jitter so clouds don't line up.
                    const phase = ((i + 0.5) / count + (rand() - 0.5) * 0.15) % 1;
                    const baseX = (phase * 2 - 1) * bandHalfW;
                    // Vertical phase: clouds higher in the sky on average,
                    // but with variation. Bias upward slightly so the bottom
                    // of the frame is mostly clear for the screenshot.
                    const baseY = (rand() - 0.35) * 2 * bandHalfH;
                    // Cloud size in world units. Closer clouds bigger.
                    // At z = -2, size ~ 4.5; at z = -8, size ~ 2.5.
                    const depthT = (z + 8) / 6; // 0 at far, 1 at near
                    const sizeBase = 2.5 + depthT * 2.2 + rand() * 1.0;
                    const aspect = 1.4 + rand() * 0.6; // wider than tall
                    const w = sizeBase * aspect;
                    const h = sizeBase;
                    // Drift speed factor — closer clouds move noticeably faster
                    // (depth parallax). Wider spread than before so the layer
                    // reads as a stacked-depth sky rather than a single
                    // translating field.
                    // At depth=0 (far): 0.3× base; at depth=1 (near): 1.7× base.
                    const speedFactor = 0.3 + depthT * 1.4;
                    // Pointer parallax factor — closer clouds shift more.
                    const parallaxFactor = 0.2 + depthT * 1.0;
                    // Build the canvas + texture. Larger canvases for nearer
                    // clouds so they don't pixelate when scaled up.
                    const canvasSize = depthT > 0.6 ? 384 : 256;
                    const canvasH = Math.round(canvasSize * 0.72);
                    const cv = buildCloudCanvas(canvasSize, canvasH, Math.floor(rand() * 1e6) + i * 17, tint);
                    const tex = new THREE.CanvasTexture(cv);
                    tex.colorSpace = THREE.SRGBColorSpace;
                    tex.minFilter = THREE.LinearFilter;
                    tex.magFilter = THREE.LinearFilter;
                    tex.generateMipmaps = false;
                    tex.anisotropy = renderer.capabilities.getMaxAnisotropy?.() || 8;
                    tex.needsUpdate = true;
                    const mat = new THREE.MeshBasicMaterial({
                        map: tex,
                        transparent: true,
                        opacity: cloudOpacity,
                        depthWrite: false,
                        depthTest: true,
                        toneMapped: false,
                        side: THREE.DoubleSide,
                    });
                    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
                    mesh.position.set(baseX, baseY, z);
                    mesh.renderOrder = -100 + i; // stable cloud-vs-cloud order
                    cloudGroup.add(mesh);
                    state.clouds.push({
                        mesh,
                        baseX,
                        baseY,
                        z,
                        speedFactor,
                        parallaxFactor,
                        halfW: w * 0.5,
                        halfH: h * 0.5,
                        texture: tex,
                        material: mat,
                    });
                }
            }
            function applyScreenLayout() {
                if (!state.screenMesh || !state.screenGroup)
                    return;
                const aspect = state.screenshotAspect || 16 / 9;
                const baseHeight = 2.0; // world units before scale
                const liveScale = propsRef.current.screenshotScale;
                const liveX = propsRef.current.screenshotX;
                const liveY = propsRef.current.screenshotY;
                const liveTilt = propsRef.current.screenshotTilt;
                const planeH = baseHeight * liveScale;
                const planeW = planeH * aspect;
                state.screenMesh.geometry?.dispose?.();
                state.screenMesh.geometry = new THREE.PlaneGeometry(planeW, planeH);
                // Mesh local rotation = tilt; group carries X/Y offset.
                state.screenMesh.rotation.set((liveTilt * Math.PI) / 180, 0, 0);
                state.screenGroup.position.set(liveX, liveY, 0);
            }
            state.rebuildClouds = rebuildClouds;
            state.applyScreenLayout = applyScreenLayout;
        })();
        return () => {
            cancelled = true;
            const state = stateRef.current;
            for (const c of state.clouds || []) {
                try {
                    c.mesh.geometry?.dispose?.();
                }
                catch { }
                try {
                    c.material?.dispose?.();
                }
                catch { }
                try {
                    c.texture?.dispose?.();
                }
                catch { }
            }
            state.clouds = [];
            try {
                state.skyMesh?.geometry?.dispose?.();
            }
            catch { }
            try {
                state.skyMat?.dispose?.();
            }
            catch { }
            try {
                state.screenMesh?.geometry?.dispose?.();
            }
            catch { }
            try {
                state.screenMat?.dispose?.();
            }
            catch { }
            try {
                state.screenshotTex?.dispose?.();
            }
            catch { }
            try {
                state.renderer?.dispose?.();
            }
            catch { }
            state.ready = false;
        };
        // One-shot init.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    /* ── Rebuild clouds when count / color / seed change ─────────────── */
    React.useEffect(() => {
        const state = stateRef.current;
        if (!state.ready)
            return;
        const key = `${cloudColor}|${Math.round(cloudCount)}|${stableSeed}`;
        if (key !== state.cloudColorKey) {
            state.rebuildClouds?.();
        }
    }, [cloudColor, cloudCount, stableSeed, threeReady]);
    /* ── Reactive parameter updates ──────────────────────────────────── */
    React.useEffect(() => {
        const state = stateRef.current;
        if (!state.ready)
            return;
        // Sky.
        state.skyMat.uniforms.u_top.value.set(skyTop);
        state.skyMat.uniforms.u_bottom.value.set(skyBottom);
        state.skyMesh.visible = !transparentBackground;
        // Cloud opacity — push to all live cloud materials in place.
        for (const c of state.clouds) {
            if (c.material)
                c.material.opacity = cloudOpacity;
        }
        // Hemisphere matches the sky for consistent ambient cast.
        try {
            state.hemi.color.set(skyTop);
        }
        catch { }
        try {
            state.hemi.groundColor.set(skyBottom);
        }
        catch { }
        // Screen layout (scale/x/y/tilt may have changed).
        state.applyScreenLayout?.();
    }, [
        threeReady,
        skyTop, skyBottom, transparentBackground,
        cloudOpacity,
        screenshotScale, screenshotX, screenshotY, screenshotTilt,
    ]);
    /* ── Prefetch screenshot bytes as early as possible ──────────────── */
    // Start the screenshot download immediately on mount so it overlaps the
    // three.js module evaluation. The TextureLoader fetch below then resolves
    // from the HTTP cache instead of waiting for three.js to finish loading.
    React.useEffect(() => {
        if (!screenshot || typeof Image === 'undefined')
            return;
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = screenshot;
    }, [screenshot]);
    /* ── Load screenshot ─────────────────────────────────────────────── */
    React.useEffect(() => {
        const state = stateRef.current;
        if (!state.ready || !state.THREE)
            return;
        if (state.screenshotKey === screenshot)
            return;
        state.screenshotKey = screenshot;
        const THREE = state.THREE;
        if (!screenshot) {
            if (state.screenshotTex) {
                state.screenshotTex.dispose?.();
                state.screenshotTex = null;
            }
            state.screenMat.map = null;
            state.screenMat.color.setRGB(0.92, 0.92, 0.93);
            state.screenMat.needsUpdate = true;
            setAssetsReady(true);
            return;
        }
        const loader = new THREE.TextureLoader();
        loader.setCrossOrigin?.('anonymous');
        loader.load(screenshot, (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.anisotropy = state.renderer.capabilities.getMaxAnisotropy?.() || 8;
            tex.minFilter = THREE.LinearMipmapLinearFilter;
            tex.magFilter = THREE.LinearFilter;
            tex.generateMipmaps = true;
            const im = tex.image;
            const w = im?.naturalWidth || im?.width || 16;
            const h = im?.naturalHeight || im?.height || 9;
            state.screenshotAspect = Math.max(0.1, w / Math.max(1, h));
            if (state.screenshotTex)
                state.screenshotTex.dispose?.();
            state.screenshotTex = tex;
            state.screenMat.map = tex;
            state.screenMat.color.setRGB(1, 1, 1);
            state.screenMat.needsUpdate = true;
            state.applyScreenLayout?.();
            setAssetsReady(true);
        }, undefined, (err) => {
            console.error('[calm-cloud-interface] screenshot load failed:', err);
            setAssetsReady(true);
        });
    }, [screenshot, threeReady]);
    /* ── Resize ──────────────────────────────────────────────────────── */
    React.useEffect(() => {
        const state = stateRef.current;
        if (!state.ready)
            return;
        const w = Math.max(2, size.width || (canvasRef.current?.parentElement?.clientWidth ?? 1440));
        const h = Math.max(2, size.height || (canvasRef.current?.parentElement?.clientHeight ?? 760));
        state.renderer.setSize(w, h, false);
        state.camera.aspect = w / h;
        state.camera.updateProjectionMatrix();
    }, [size.width, size.height, threeReady]);
    /* ── Animation loop ──────────────────────────────────────────────── */
    useHeroAnimationFrame(props.rootRef, ({ delta }) => {
        const state = stateRef.current;
        if (!state.ready || !state.renderer || !state.scene || !state.camera)
            return;
        const live = propsRef.current;
        const dt = Math.max(0.001, Math.min(0.1, delta));
        // Accumulate drift phase using the CURRENT slider values so changes
        // don't snap the phase. cloudSpeed is the user-facing multiplier on
        // top of cloudDriftSpeed; both pre-multiply the accumulator each
        // frame instead of being applied at sample time, so the visible
        // position is continuous when either slider moves.
        if (!reducedMotion) {
            state.driftPhase += dt * live.cloudDriftSpeed * live.cloudSpeed * 0.55;
        }
        // Pointer-driven camera target. Y FLIPPED: input.y=0 (top of canvas)
        // should drive camera UP (positive world Y).
        const ix = (input && typeof input.x === 'number') ? input.x : 0.5;
        const iy = (input && typeof input.y === 'number') ? input.y : 0.5;
        const active = !!(input && input.active);
        const maxDrift = live.pointerCameraDrift; // already in world units (request was ±0.3 at default 0.7)
        // Scale 0..1.5 slider onto ±0.3..±0.45 world units. At default 0.7 → ±0.21.
        const driftScale = 0.3;
        state.camTargetX = active ? (ix - 0.5) * 2 * maxDrift * driftScale : 0;
        state.camTargetY = active ? -(iy - 0.5) * 2 * maxDrift * driftScale : 0;
        const tau = 0.18;
        const k = 1 - Math.exp(-dt / tau);
        state.camX += (state.camTargetX - state.camX) * k;
        state.camY += (state.camTargetY - state.camY) * k;
        state.camera.position.set(state.camX, state.camY, 5.5);
        state.camera.lookAt(0, 0, 0);
        // Update each cloud: ambient leftward drift + pointer parallax shift.
        // Wrap around the band so clouds never pop in/out.
        const bandHalfW = 14;
        const wrapW = bandHalfW * 2;
        const parallaxAmt = live.pointerParallax;
        // Pointer parallax target in world units (deeper clouds shift less).
        const pxBase = active ? (ix - 0.5) * 2 * parallaxAmt * 1.2 : 0;
        const pyBase = active ? -(iy - 0.5) * 2 * parallaxAmt * 0.8 : 0;
        for (const c of state.clouds) {
            // Ambient X drift.
            const drift = state.driftPhase * c.speedFactor;
            let x = c.baseX - drift * 2.0; // world units travelled
            // Wrap into [-bandHalfW, +bandHalfW]. Add wrapW then modulo.
            x = ((x + bandHalfW) % wrapW + wrapW) % wrapW - bandHalfW;
            // Pointer parallax shift, scaled by depth.
            const px = pxBase * c.parallaxFactor;
            const py = pyBase * c.parallaxFactor;
            c.mesh.position.set(x + px, c.baseY + py, c.z);
        }
        state.renderer.setClearColor(0x000000, 0);
        state.renderer.render(state.scene, state.camera);
    });
    return (_jsxs(_Fragment, { children: [_jsx("crazygl-stage", { style: { position: 'absolute', inset: 0, zIndex: 0, overflow: 'hidden' }, children: _jsx("canvas", { ref: canvasRef, className: "crazygl-cloud-canvas", "aria-hidden": "true" }) }), _jsx("crazygl-content", { style: {
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-start',
                    padding: 'clamp(1.5rem, 5vw, 4rem)',
                    zIndex: 1,
                    pointerEvents: 'none',
                }, children: _jsx("div", { className: "crazygl-cloud-content", children: content.node }) })] }));
}
export default function CalmCloudInterface(props) {
    return _jsx(CrazyGLWrapper, { hero: CalmCloudHero, metadata: metadata, ...props });
}
export { metadata };

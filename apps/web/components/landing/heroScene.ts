import { Camera, Mesh, Plane, Program, RenderTarget, Renderer, Texture, Transform, Triangle } from "ogl";

/**
 * The landing hero in one WebGL canvas: a topographic background that follows the active card's colour and bends
 * around the pointer, and the cards bent along an elliptic ring (the same ring maths as the reference carousel).
 */

const cardVertex = /* glsl */ `
attribute vec3 position;
attribute vec2 uv;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float uProgress;
uniform float uRadius;
uniform float uIndex;
uniform float uCount;
uniform float uMargin;
varying vec2 vUv;
varying float vFront;
#define PI 3.14159265359
void main() {
  vec3 p = position;
  p.xy *= 1.0 - uMargin;
  float stride = 1.0 / uCount;
  float circle = -(uIndex + p.x) * stride + uProgress + 0.25;
  float angle = circle * 2.0 * PI;
  p.x = cos(angle) * uRadius;
  p.z = sin(angle) * uRadius * 0.5;
  vUv = uv;
  vFront = sin(angle);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const cardFragment = /* glsl */ `
precision highp float;
uniform sampler2D tMap;
uniform float uImageAspect;
uniform float uCardAspect;
uniform vec2 uShift;
varying vec2 vUv;
varying float vFront;
void main() {
  vec2 uv = vUv;
  float r = uCardAspect / uImageAspect;
  if (r < 1.0) uv.x = (uv.x - 0.5) * r + 0.5; else uv.y = (uv.y - 0.5) / r + 0.5;
  uv = (uv - 0.5) * 0.92 + 0.5 + uShift;
  vec3 c = texture2D(tMap, uv).rgb;
  float light = mix(0.28, 1.0, smoothstep(-0.3, 0.95, vFront));
  gl_FragColor = vec4(c * light, 1.0);
}`;

/**
 * A small velocity field that the pointer stirs: it carries itself along and fades, like the reference's fluid but
 * at 64 x 64 and without a pressure step. Stored as RGBA8 (velocity x 0.5 + 0.5) so it runs on every GPU.
 */
const fluidFragment = /* glsl */ `
precision highp float;
uniform sampler2D tPrev;
uniform vec2 uPoint;
uniform vec2 uDir;
uniform float uAspect;
varying vec2 vUv;
void main() {
  vec2 v = texture2D(tPrev, vUv).xy * 2.0 - 1.0;
  vec2 a = texture2D(tPrev, vUv - v * 0.02).xy * 2.0 - 1.0;
  a *= 0.972;
  vec2 d = vUv - uPoint;
  d.x *= uAspect;
  a += uDir * exp(-dot(d, d) / 0.0045);
  a = clamp(a, -1.0, 1.0);
  if (length(a) < 0.012) a = vec2(0.0);
  gl_FragColor = vec4(a * 0.5 + 0.5, 0.0, 1.0);
}`;

const bgVertex = /* glsl */ `
attribute vec2 position;
attribute vec2 uv;
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position, 0.0, 1.0); }`;

const bgFragment = /* glsl */ `
precision highp float;
uniform float uTime;
uniform vec2 uRes;
uniform vec2 uMouse;
uniform float uForce;
uniform sampler2D tFluid;
uniform vec3 uBase;
uniform vec3 uLine;
varying vec2 vUv;
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m; m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
void main() {
  vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0) * 2.0;
  vec2 m = (uMouse - 0.5) * vec2(uRes.x / uRes.y, 1.0) * 2.0;
  vec2 vel = texture2D(tFluid, vUv).xy * 2.0 - 1.0;
  p -= vel * vec2(0.55, -0.55);
  // Wide, thin rings around a point near the top, stretched sideways, as in the reference.
  float f = length((p - vec2(0.35, 1.05)) * vec2(0.6, 1.0)) * 1.8
          + snoise(p * 0.45 + vec2(0.0, uTime * 0.03)) * 0.14
          + snoise(p * 1.1 - vec2(uTime * 0.02, 0.0)) * 0.035;
  float band = abs(fract(f * 4.6) - 0.5);
  float line = smoothstep(0.445, 0.468, band);
  vec3 ink = mix(uLine, vec3(1.0), 0.55);
  vec3 col = mix(uBase, ink, line * 0.42);
  // Light from the top right, falling off toward the bottom left.
  float light = smoothstep(-0.15, 1.15, vUv.x * 0.85 + vUv.y * 0.55);
  col *= mix(0.42, 1.38, light);
  col *= mix(0.6, 1.0, smoothstep(0.0, 0.45, vUv.y));
  gl_FragColor = vec4(col, 1.0);
}`;

export type Palette = { base: [number, number, number]; line: [number, number, number] };

function hex(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function palette(base: string, line: string): Palette {
  return { base: hex(base), line: hex(line) };
}

const FOV = 35;
/** Share of the viewport width the front card fills. */
const FRONT_SHARE = 0.72;
const MARGIN = 0.1;
const CARD_HEIGHT = 0.6;
/** Ring pose of the reference: the right side higher, the top leaning away as if seen from below. */
const BASE_TILT_Z = 0.075;
const BASE_TILT_X = -0.16;

export class HeroScene {
  private renderer: Renderer;
  private camera: Camera;
  private scene = new Transform();
  private ring = new Transform();
  private cards: Mesh[] = [];
  private bg: Mesh;
  private bgProgram: Program;
  private fluid: Mesh;
  private fluidProgram: Program;
  private targets: [RenderTarget, RenderTarget];
  private splat = { x: 0.5, y: 0.5, dx: 0, dy: 0 };
  private raf = 0;
  private running = false;
  private start = performance.now();
  private colorFrom: Palette;
  private colorTo: Palette;
  private colorT = 1;
  private mouse = { x: 0.5, y: 0.5, force: 0 };
  /** Pointer position for the hover parallax, eased toward \`aim\` every frame. */
  private tilt = { x: 0, y: 0 };
  private aim = { x: 0, y: 0 };
  private count: number;
  progress = 0;
  sway = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    images: string[],
    first: Palette,
    private still: boolean,
  ) {
    this.count = images.length;
    this.renderer = new Renderer({ canvas, dpr: Math.min(window.devicePixelRatio || 1, 1.5), alpha: false, antialias: true });
    const gl = this.renderer.gl;
    gl.clearColor(0, 0, 0, 1);
    this.camera = new Camera(gl, { fov: FOV });
    this.colorFrom = first;
    this.colorTo = first;

    this.bgProgram = new Program(gl, {
      vertex: bgVertex,
      fragment: bgFragment,
      depthTest: false,
      depthWrite: false,
      uniforms: { uTime: { value: 0 }, uRes: { value: [1, 1] }, uMouse: { value: [0.5, 0.5] }, uForce: { value: 0 }, uBase: { value: first.base }, uLine: { value: first.line } },
    });
    this.bg = new Mesh(gl, { geometry: new Triangle(gl), program: this.bgProgram });

    const rt = () => new RenderTarget(gl, { width: 64, height: 64, depth: false, minFilter: gl.LINEAR, magFilter: gl.LINEAR });
    this.targets = [rt(), rt()];
    this.fluidProgram = new Program(gl, {
      vertex: bgVertex,
      fragment: fluidFragment,
      depthTest: false,
      depthWrite: false,
      uniforms: { tPrev: { value: this.targets[0].texture }, uPoint: { value: [0.5, 0.5] }, uDir: { value: [0, 0] }, uAspect: { value: 1 } },
    });
    this.fluid = new Mesh(gl, { geometry: new Triangle(gl), program: this.fluidProgram });
    this.bgProgram.uniforms.tFluid = { value: this.targets[0].texture };
    // Start from a still field: 0.5 in both channels means no velocity.
    for (const t of this.targets) {
      this.renderer.bindFramebuffer(t);
      gl.viewport(0, 0, 64, 64);
      gl.clearColor(0.5, 0.5, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    this.renderer.bindFramebuffer();
    gl.clearColor(0, 0, 0, 1);

    const radius = 1 / (2 * Math.sin(Math.PI / this.count));
    const geometry = new Plane(gl, { width: 1, height: CARD_HEIGHT, widthSegments: 48, heightSegments: 1 });
    const cardAspect = ((1 - MARGIN) * 2 * Math.PI * radius) / this.count / ((1 - MARGIN) * CARD_HEIGHT);
    images.forEach((src, i) => {
      const texture = new Texture(gl, { generateMipmaps: false, minFilter: gl.LINEAR });
      const program = new Program(gl, {
        vertex: cardVertex,
        fragment: cardFragment,
        cullFace: false,
        uniforms: {
          tMap: { value: texture },
          uProgress: { value: 0 },
          uRadius: { value: radius },
          uIndex: { value: i },
          uCount: { value: this.count },
          uMargin: { value: MARGIN },
          uImageAspect: { value: 16 / 9 },
          uCardAspect: { value: cardAspect },
          uShift: { value: [0, 0] },
        },
      });
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        texture.image = img;
        program.uniforms.uImageAspect!.value = img.naturalWidth / img.naturalHeight;
        if (!this.running) this.render(0);
      };
      img.src = src;
      const mesh = new Mesh(gl, { geometry, program });
      mesh.setParent(this.ring);
      this.cards.push(mesh);
    });
    this.ring.setParent(this.scene);
    this.ring.rotation.z = BASE_TILT_Z;
    this.ring.rotation.x = BASE_TILT_X;
    this.resize();
  }

  resize() {
    const box = this.canvas.parentElement ?? this.canvas;
    const w = box.clientWidth || 1;
    const h = box.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.camera.perspective({ aspect: w / h });
    const frontWidth = (1 - MARGIN) * ((2 * Math.PI * (1 / (2 * Math.sin(Math.PI / this.count)))) / this.count);
    const distance = frontWidth / (FRONT_SHARE * 2 * Math.tan(((FOV / 2) * Math.PI) / 180) * (w / h));
    const radius = 1 / (2 * Math.sin(Math.PI / this.count));
    this.ring.position.set(0.02, -0.045, -(distance + radius * 0.5));
    this.bgProgram.uniforms.uRes!.value = [w, h];
    this.fluidProgram.uniforms.uAspect!.value = w / h;
    if (!this.running) this.render(0);
  }

  setPalette(next: Palette) {
    this.colorFrom = this.currentPalette();
    this.colorTo = next;
    this.colorT = this.still ? 1 : 0;
    if (!this.running) this.render(0);
  }

  /** Pointer in section units (0 to 1, y down) with its movement since the last event, also in section units. */
  pointer(x: number, y: number, dx = 0, dy = 0) {
    this.mouse.x = x;
    this.mouse.y = 1 - y;
    if (this.still) return;
    this.aim = { x: x - 0.5, y: y - 0.5 };
    this.splat = { x, y: 1 - y, dx: this.splat.dx + dx * 9, dy: this.splat.dy - dy * 9 };
  }

  private currentPalette(): Palette {
    const t = this.colorT;
    const mix = (a: number[], b: number[]) => a.map((v, i) => v + (b[i]! - v) * t) as [number, number, number];
    return { base: mix(this.colorFrom.base, this.colorTo.base), line: mix(this.colorFrom.line, this.colorTo.line) };
  }

  private render(time: number) {
    const u = this.bgProgram.uniforms;
    this.colorT = Math.min(1, this.colorT + 0.025);
    const pal = this.currentPalette();
    u.uBase!.value = pal.base;
    u.uLine!.value = pal.line;
    u.uTime!.value = time;
    this.mouse.force *= 0.94;
    if (!this.still) {
      const f = this.fluidProgram.uniforms;
      f.tPrev!.value = this.targets[0].texture;
      f.uPoint!.value = [this.splat.x, this.splat.y];
      f.uDir!.value = [Math.max(-1, Math.min(1, this.splat.dx)), Math.max(-1, Math.min(1, this.splat.dy))];
      this.splat.dx = 0;
      this.splat.dy = 0;
      this.renderer.render({ scene: this.fluid, target: this.targets[1], clear: false });
      this.targets.reverse();
      u.tFluid!.value = this.targets[0].texture;
    }
    u.uMouse!.value = [this.mouse.x, this.mouse.y];
    u.uForce!.value = this.mouse.force;
    this.tilt.x += (this.aim.x - this.tilt.x) * 0.06;
    this.tilt.y += (this.aim.y - this.tilt.y) * 0.06;
    this.ring.rotation.y = this.tilt.x * 0.16;
    this.ring.rotation.x = BASE_TILT_X + this.tilt.y * 0.1;
    const turns = (this.progress + this.sway) / this.count;
    const shift = [-this.tilt.x * 0.05, this.tilt.y * 0.04];
    for (const c of this.cards) {
      c.program.uniforms.uProgress!.value = turns;
      c.program.uniforms.uShift!.value = shift;
    }
    this.renderer.render({ scene: this.bg, clear: true });
    this.renderer.render({ scene: this.scene, camera: this.camera, clear: false });
  }

  play() {
    if (this.running) return;
    this.running = true;
    const loop = (now: number) => {
      if (!this.running) return;
      const t = (now - this.start) / 1000;
      if (!this.still) this.sway = Math.sin(t * 0.55) * 0.035;
      this.render(this.still ? 0 : t);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  pause() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** Draws one frame when the loop is paused, for example while scrubbing with reduced motion. */
  draw() {
    if (!this.running) this.render(0);
  }

  /** Stops drawing. The context is left alive: React may mount the scene again on the same canvas. */
  destroy() {
    this.pause();
  }
}

export function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

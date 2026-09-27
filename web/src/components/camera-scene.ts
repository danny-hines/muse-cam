// Three.js renderer for the home-page camera. Loaded lazily by CameraShowcase so
// the library stays out of the initial bundle.
import {
  Box3,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NeutralToneMapping,
  Path,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  SRGBColorSpace,
  Texture,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// Colorways paint two groups of printed parts; the lens parts stay matte black.
type Role = "front" | "housing";

export type Colorway = { name: string; colors: Record<Role, string> };

const INK = "#1d1d1b";
const CREAM = "#ece4d3";

export const COLORWAYS: Colorway[] = [
  { name: "Cream & black", colors: { front: CREAM, housing: INK } },
  { name: "Orange & white", colors: { front: "#f5f3ee", housing: "#f0761d" } },
  { name: "Violet & paper", colors: { front: "#f4f0e8", housing: "#6657de" } },
  { name: "Acid & ink", colors: { front: "#d7ff42", housing: INK } },
  { name: "Coral & cream", colors: { front: "#ff6c51", housing: CREAM } },
];

// Pieces that move together when the camera comes apart. Offsets are in
// millimetres (Y up, Z out of the lens), and delays stagger them on a 0–1
// timeline. The screws back out first, spinning. The front body slides past
// the lens back, which sits behind it in the build, while the screen, Pi,
// PiSugar and battery slide out of the rear opening in order.
type UnitConfig = { offset: [number, number, number]; delay: number; turns?: number };
const UNITS = {
  body_main: { offset: [0, 0, 0], delay: 0 },
  front_screws: { offset: [0, 0, 58], delay: 0, turns: 4 },
  rear_screw: { offset: [0, 0, -22], delay: 0, turns: 4 },
  door_top: { offset: [0, 34, 0], delay: 0.04 },
  screen: { offset: [0, 0, -110], delay: 0.06 },
  door_side: { offset: [30, 0, 0], delay: 0.08 },
  shutter: { offset: [0, 24, 0], delay: 0.1 },
  body_front: { offset: [0, 0, 40], delay: 0.1 },
  lens_front: { offset: [0, 0, 64], delay: 0.12 },
  pi: { offset: [0, 0, -99], delay: 0.14 },
  lens_back: { offset: [0, 0, 20], delay: 0.18 },
  pisugar: { offset: [0, 0, -83], delay: 0.2 },
  battery: { offset: [0, 0, -65], delay: 0.26 },
} satisfies Record<string, UnitConfig>;
type UnitName = keyof typeof UNITS;
const MAX_DELAY = Math.max(...Object.values(UNITS).map((unit) => unit.delay));

// Printed parts from hardware/stl and the colorway role each one takes.
const PRINTED: Partial<Record<UnitName, Role>> = {
  body_main: "housing",
  door_top: "housing",
  body_front: "front",
  door_side: "front",
};

const EXPLODE_SECONDS = 1.4;
const HOLD_SECONDS = 3.4;
const REPRINT_SECONDS = 2.4;
const PHOTO_SECONDS = 1.1;
const PHOTO_FADE_SECONDS = 0.25;
const ASSEMBLED_SPIN = 0.42;
const EXPLODED_SPIN = 0.16;
const ELEVATION = (16 * Math.PI) / 180;
const FOV = 26;

type Manifest = {
  scale: number;
  origin: [number, number, number];
  size: [number, number, number];
  parts: {
    name: string;
    unit: UnitName;
    colour?: string;
    metal?: boolean;
    vertexCount: number;
    indexCount: number;
    positionOffset: number;
    normalOffset: number;
    indexOffset: number;
  }[];
};

export type CameraSceneOptions = {
  reducedMotion: boolean;
  onColorway(colorway: Colorway): void;
  onTap(): void;
};

export type CameraScene = {
  setPinned(pinned: boolean): void;
  dispose(): void;
};

async function loadModel(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Camera model request failed: ${response.status}`);
  const buffer = await response.arrayBuffer();
  const view = new DataView(buffer);
  if (new TextDecoder().decode(new Uint8Array(buffer, 0, 4)) !== "MCAM") throw new Error("Not a camera model");
  const jsonLength = view.getUint32(4, true);
  const manifest = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 8, jsonLength))) as Manifest;
  const body = 8 + jsonLength;
  const parts = [];
  for (const part of manifest.parts) {
    const geometry = new BufferGeometry();
    // Dequantise to floats: scaling the Int16 attribute in place would round
    // every vertex to the nearest millimetre.
    const quantised = new Int16Array(buffer, body + part.positionOffset, part.vertexCount * 3);
    const positions = Float32Array.from(quantised, (value) => value * manifest.scale);
    const normals = new Int8Array(buffer, body + part.normalOffset, part.vertexCount * 3);
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new BufferAttribute(normals, 3, true));
    geometry.setIndex(new BufferAttribute(new Uint16Array(buffer, body + part.indexOffset, part.indexCount), 1));
    parts.push({ ...part, geometry });
  }
  return { manifest, parts };
}

function canvasTexture(width: number, height: number, draw: (context: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext("2d")!);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

// Stand-ins for parts with no CAD model, placed from measurements of the
// enclosure. `at` converts CAD millimetres (+X right, +Y out of the lens,
// -Z up) to model space.
type CadPoint = (x: number, y: number, z: number) => [number, number, number];

type Reel = { image: HTMLImageElement; tileWidth: number; tileHeight: number; columns: number; styles: string[] };

// Photos from the camera, packed into one atlas by scripts/build-screen-reel.mjs.
async function loadReel(url: string): Promise<Reel> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Screen reel request failed: ${response.status}`);
  const manifest = (await response.json()) as Omit<Reel, "image"> & { image: string };
  const image = new Image();
  image.src = new URL(manifest.image, new URL(url, window.location.href)).href;
  await image.decode();
  return { ...manifest, image };
}

function screenGlass(at: CadPoint) {
  // The 106 × 68 × 4 mm glass of the Fusion screen stand-in (the export's board
  // and spacers are in the internals file), showing a 95 × 54 mm active area:
  // a sunset until the photo reel loads.
  const width = 106;
  const height = 68;
  const pxPerMm = 6;
  const canvas = document.createElement("canvas");
  canvas.width = width * pxPerMm;
  canvas.height = height * pxPerMm;
  const context = canvas.getContext("2d")!;
  const face = new CanvasTexture(canvas);
  face.colorSpace = SRGBColorSpace;
  const area = { x: ((width - 95) / 2) * pxPerMm, y: ((height - 54) / 2) * pxPerMm, w: 95 * pxPerMm, h: 54 * pxPerMm };

  context.fillStyle = "#060607";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const sky = context.createLinearGradient(0, area.y, 0, area.y + area.h);
  sky.addColorStop(0, "#3a2f86");
  sky.addColorStop(0.55, "#b8577a");
  sky.addColorStop(1, "#f08a52");
  context.fillStyle = sky;
  context.fillRect(area.x, area.y, area.w, area.h);
  const sunX = area.x + area.w * 0.62;
  const sunY = area.y + area.h * 0.64;
  const sun = context.createRadialGradient(sunX, sunY, 0, sunX, sunY, area.h * 0.5);
  sun.addColorStop(0, "rgba(255, 236, 170, 0.95)");
  sun.addColorStop(0.25, "rgba(255, 190, 120, 0.5)");
  sun.addColorStop(1, "rgba(255, 190, 120, 0)");
  context.fillStyle = sun;
  context.fillRect(area.x, area.y, area.w, area.h);

  // Crossfades from one reel photo to the next, captioned with its style the
  // way the camera's own screen names the current style.
  function showPhoto(reel: Reel, from: number, to: number, blend: number) {
    context.fillStyle = "#060607";
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (const [index, alpha] of [[from, 1], [to, blend]]) {
      if (alpha <= 0) continue;
      context.globalAlpha = alpha;
      const sx = (index % reel.columns) * reel.tileWidth;
      const sy = Math.floor(index / reel.columns) * reel.tileHeight;
      context.drawImage(reel.image, sx, sy, reel.tileWidth, reel.tileHeight, area.x, area.y, area.w, area.h);
    }
    context.globalAlpha = 1;
    const shade = context.createLinearGradient(0, area.y + area.h - 90, 0, area.y + area.h);
    shade.addColorStop(0, "rgba(0, 0, 0, 0)");
    shade.addColorStop(1, "rgba(0, 0, 0, 0.62)");
    context.fillStyle = shade;
    context.fillRect(area.x, area.y + area.h - 90, area.w, 90);
    context.font = '600 24px system-ui, -apple-system, "Segoe UI", sans-serif';
    context.fillStyle = "#ffffff";
    for (const [index, alpha] of [[from, 1 - blend], [to, blend]]) {
      if (alpha <= 0) continue;
      context.globalAlpha = alpha;
      context.fillText(reel.styles[index], area.x + 20, area.y + area.h - 20);
    }
    context.globalAlpha = 1;
    face.needsUpdate = true;
  }

  const bezel = new MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.5 });
  const glass = new MeshStandardMaterial({
    color: 0x000000,
    roughness: 0.08,
    emissive: 0xffffff,
    emissiveMap: face,
  });
  const depth = 4;
  // BoxGeometry faces: +x, -x, +y, -y, +z, -z. The display faces out the back.
  const mesh = new Mesh(new BoxGeometry(width, height, depth), [bezel, bezel, bezel, bezel, bezel, glass]);
  const [x, y, z] = at(53.5, 1.3 + depth / 2, 34.5);
  mesh.position.set(x, y, z);
  return { mesh, showPhoto };
}

function shutter(at: CadPoint) {
  // 10 mm momentary switch in the counterbored hole above the grip. The
  // profile starts on the counterbore ledge, 2 mm below the top surface.
  const profile = [
    [0, 3.7], [2, 3.62], [3.4, 3.35], [4.1, 2.9], [4.3, 2.3], [4.3, 1.5],
    [5.7, 1.5], [6.1, 1.3], [6.2, 0.9], [6.2, 0],
  ].map(([r, h]) => new Vector2(r, h));
  const mesh = new Mesh(
    new LatheGeometry(profile.reverse(), 40),
    new MeshPhysicalMaterial({ color: 0x111112, roughness: 0.28, clearcoat: 0.8, clearcoatRoughness: 0.2 }),
  );
  const [x, y, z] = at(1.25, 47.5, -7);
  mesh.position.set(x, y, z);
  return mesh;
}

function lensGlass(at: CadPoint) {
  // Coated glass on top of the Camera Module 3 lens barrel, which ends 1.3 mm
  // behind the front of the lens_front aperture.
  const radius = 6;
  const angle = 0.45;
  const glass = new Mesh(
    new SphereGeometry(radius, 40, 8, 0, Math.PI * 2, 0, angle),
    new MeshPhysicalMaterial({ color: 0x06070c, roughness: 0.04, metalness: 0.3, iridescence: 1, iridescenceIOR: 1.35, clearcoat: 1 }),
  );
  // The cap points along +Y; turn it to face out of the lens.
  glass.rotation.x = Math.PI / 2;
  const [x, y, z] = at(69.9, 65.8 - radius * Math.cos(angle), 34.5);
  glass.position.set(x, y, z);
  return glass;
}

// ISO 4762 M3 × 12 socket head cap screw, built along +Y with the underside of
// its 5.5 × 3 mm head at 0. One geometry is shared by every screw.
function screwGeometry() {
  const point = ([r, h]: number[]) => new Vector2(r, h);
  // Shank, underside and side of the head, up to the edge of its top face.
  const body = new LatheGeometry(
    [[0, -12], [1.25, -12], [1.5, -11.75], [1.5, 0], [2.75, 0], [2.75, 2.65], [2.65, 2.9], [2.45, 3]].map(point),
    40,
  );
  // 2.5 mm hex socket, 1.4 mm deep: a six-sided lathe is a hexagonal prism.
  const socket = new LatheGeometry([[1.44, 3], [1.44, 1.6], [0, 1.6]].map(point), 6);
  // Flat top face around the socket, its hole matching the lathe's corners.
  const top = new Shape().absarc(0, 0, 2.45, 0, Math.PI * 2, false);
  const hex = new Path();
  for (let i = 0; i <= 6; i++) {
    const phi = (i / 6) * Math.PI * 2;
    if (i === 0) hex.moveTo(Math.sin(phi) * 1.44, -Math.cos(phi) * 1.44);
    else hex.lineTo(Math.sin(phi) * 1.44, -Math.cos(phi) * 1.44);
  }
  top.holes.push(hex);
  const face = new ShapeGeometry(top, 40).rotateX(-Math.PI / 2).translate(0, 3, 0);
  return mergeGeometries([body, socket, face])!;
}

// Black M3 × 12 screws: four in the front counterbores and one in the rear
// counterbore by the grip, each seated on its counterbore floor (CAD mm).
const FRONT_SCREWS: [number, number, number][] = [[21.5, 59.5, -0.5], [21.5, 59.5, 69.5], [111.5, 59.5, -0.5], [111.5, 59.5, 69.5]];
const REAR_SCREW: [number, number, number] = [-9.5, 2, -1.5];

function screw(at: CadPoint, geometry: BufferGeometry, material: MeshStandardMaterial, seat: [number, number, number], facing: 1 | -1) {
  // The holder aims the screw's +Y out of the lens (1) or out of the back (-1);
  // the mesh inside it spins as the screw backs out.
  const holder = new Group();
  holder.position.set(...at(...seat));
  holder.rotation.x = (facing * Math.PI) / 2;
  holder.add(new Mesh(geometry, material));
  return holder;
}

// Filament material that can be "reprinted" layer by layer: below uEdge
// (model-space mm, Y up) the surface shows uTo, above it uFrom, with a hot line
// at the edge.
function printedMaterial(color: string) {
  const uniforms = {
    uFrom: { value: new Color(color) },
    uTo: { value: new Color(color) },
    uEdge: { value: -1e4 },
    uGlow: { value: 0 },
  };
  const material = new MeshStandardMaterial({ roughness: 0.62, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying float vLayer;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvLayer = position.y;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying float vLayer;\nuniform vec3 uFrom;\nuniform vec3 uTo;\nuniform float uEdge;\nuniform float uGlow;",
      )
      .replace(
        "vec4 diffuseColor = vec4( diffuse, opacity );",
        "vec4 diffuseColor = vec4( mix( uTo, uFrom, smoothstep( uEdge - 0.3, uEdge + 0.3, vLayer ) ), opacity );",
      )
      .replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3( 1.0, 0.93, 0.78 ) * uGlow * exp( -abs( vLayer - uEdge ) * 0.9 );",
      );
  };
  return { material, uniforms };
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

// Where the colorway cycle is after `seconds`: each colorway holds, then the
// next is reprinted over it from the bottom up. A new cycle starts at progress
// 0 in the same instant `current` advances.
export function colorwayCycle(seconds: number, count = COLORWAYS.length) {
  const length = HOLD_SECONDS + REPRINT_SECONDS;
  const cycle = Math.floor(seconds / length);
  return {
    current: cycle % count,
    next: (cycle + 1) % count,
    progress: clamp01((seconds - cycle * length - HOLD_SECONDS) / REPRINT_SECONDS),
  };
}
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export async function createCameraScene(
  canvas: HTMLCanvasElement,
  models: { enclosure: string; internals: string; reel: string },
  { reducedMotion, onColorway, onTap }: CameraSceneOptions,
): Promise<CameraScene> {
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = NeutralToneMapping;

  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = environment;
  pmrem.dispose();

  const key = new DirectionalLight(0xffffff, 1.4);
  key.position.set(2, 3, 2.5);
  scene.add(key);

  const camera = new PerspectiveCamera(FOV, 1, 0.1, 50);

  function dispose() {
    scene.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      object.geometry.dispose();
      for (const material of [object.material].flat()) {
        for (const value of Object.values(material)) if (value instanceof Texture) value.dispose();
        material.dispose();
      }
    });
    environment.dispose();
    renderer.dispose();
  }

  let model: Awaited<ReturnType<typeof loadModel>>;
  let internals: Awaited<ReturnType<typeof loadModel>> | null;
  try {
    // The camera still works as an empty shell if the internals fail to load.
    [model, internals] = await Promise.all([loadModel(models.enclosure), loadModel(models.internals).catch(() => null)]);
  } catch (error) {
    dispose();
    throw error;
  }

  // One scene unit is 100 mm. The assembly group is shifted so the camera spins
  // around the centre of whatever is showing, assembled or apart.
  const root = new Group();
  root.scale.setScalar(0.01);
  const spinner = new Group();
  const assembly = new Group();
  spinner.add(assembly);
  root.add(spinner);
  scene.add(root);

  const units = (Object.entries(UNITS) as [UnitName, UnitConfig][]).map(([name, config]) => {
    const group = new Group();
    assembly.add(group);
    return { name, group, ...config };
  });
  const unit = (name: UnitName) => units.find((entry) => entry.name === name)!.group;

  const materials = new Map<Role, ReturnType<typeof printedMaterial>>();
  const partMaterials = new Map<string, MeshStandardMaterial>();
  const matteBlack = new MeshStandardMaterial({ color: 0x1c1c1d, roughness: 0.85 });
  for (const part of [...model.parts, ...(internals?.parts ?? [])]) {
    const role = PRINTED[part.unit];
    let material: MeshStandardMaterial;
    if (part.colour) {
      const key = `${part.colour}${part.metal ? " metal" : ""}`;
      material =
        partMaterials.get(key) ??
        new MeshStandardMaterial({ color: part.colour, roughness: part.metal ? 0.35 : 0.5, metalness: part.metal ? 0.85 : 0 });
      partMaterials.set(key, material);
    } else if (role) {
      let printed = materials.get(role);
      if (!printed) {
        printed = printedMaterial(COLORWAYS[0].colors[role]);
        materials.set(role, printed);
      }
      material = printed.material;
    } else {
      // The printed lens parts.
      material = matteBlack;
    }
    unit(part.unit).add(new Mesh(part.geometry, material));
  }

  const [ox, oy, oz] = model.manifest.origin;
  const at: CadPoint = (x, y, z) => [x - ox, -z - oy, y - oz];
  const screen = screenGlass(at);
  unit("screen").add(screen.mesh);
  unit("shutter").add(shutter(at));
  if (internals) unit("lens_back").add(lensGlass(at));
  const screwShape = screwGeometry();
  const blackOxide = new MeshStandardMaterial({ color: 0x151517, metalness: 0.6, roughness: 0.38 });
  for (const seat of FRONT_SCREWS) unit("front_screws").add(screw(at, screwShape, blackOxide, seat, 1));
  unit("rear_screw").add(screw(at, screwShape, blackOxide, REAR_SCREW, -1));

  // Measure the camera assembled and fully apart: its centre (mm), and in scene
  // units the reach of its spinning footprint and half its height.
  function measure(t: number) {
    for (const { group, offset } of units) group.position.set(offset[0] * t, offset[1] * t, offset[2] * t);
    root.updateMatrixWorld(true);
    const box = new Box3().setFromObject(assembly);
    box.min.divideScalar(root.scale.x);
    box.max.divideScalar(root.scale.x);
    const centre = box.getCenter(new Vector3());
    const reach = Math.max(
      ...[box.min.x, box.max.x].flatMap((x) => [box.min.z, box.max.z].map((z) => Math.hypot(x - centre.x, z - centre.z))),
    );
    return { centre, reach: (reach * 1.04) / 100, halfHeight: ((box.max.y - box.min.y) / 2 / 100) * 1.04 };
  }
  const together = measure(0);
  const apart = measure(1);
  const pivot = new Vector3();

  const shadow = new Mesh(
    new PlaneGeometry(190, 150),
    new MeshBasicMaterial({
      map: canvasTexture(128, 128, (context) => {
        const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
        gradient.addColorStop(0, "rgba(23, 23, 19, 0.34)");
        gradient.addColorStop(0.55, "rgba(23, 23, 19, 0.12)");
        gradient.addColorStop(1, "rgba(23, 23, 19, 0)");
        context.fillStyle = gradient;
        context.fillRect(0, 0, 128, 128);
      }),
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -model.manifest.size[1] / 2 - 6;
  root.add(shadow);

  function resize() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  resize();

  // Interaction state.
  let hovered = false;
  let pinned = false;
  let explode = reducedMotion ? 0 : 1;
  let introDelay = reducedMotion ? 0 : 0.35;
  let angle = -0.62;
  let velocity = 0;
  let drag: { id: number; x: number; lastX: number; lastTime: number; moved: boolean } | null = null;

  const listeners: [string, (event: PointerEvent) => void][] = [
    ["pointerenter", (event) => { if (event.pointerType === "mouse") hovered = true; }],
    ["pointerleave", (event) => { if (event.pointerType === "mouse") hovered = false; }],
    ["pointerdown", (event) => {
      if (event.button !== 0) return;
      drag = { id: event.pointerId, x: event.clientX, lastX: event.clientX, lastTime: performance.now(), moved: false };
    }],
    ["pointermove", (event) => {
      if (!drag || drag.id !== event.pointerId) return;
      if (!drag.moved && Math.abs(event.clientX - drag.x) > 6) {
        drag.moved = true;
        canvas.setPointerCapture(event.pointerId);
      }
      if (!drag.moved) return;
      const now = performance.now();
      const delta = (event.clientX - drag.lastX) * 0.012;
      angle += delta;
      velocity = delta / Math.max((now - drag.lastTime) / 1000, 1 / 120);
      drag.lastX = event.clientX;
      drag.lastTime = now;
    }],
    ["pointerup", (event) => {
      if (!drag || drag.id !== event.pointerId) return;
      if (!drag.moved && event.pointerType !== "mouse") onTap();
      if (performance.now() - drag.lastTime > 80) velocity = 0;
      drag = null;
    }],
    ["pointercancel", () => { drag = null; }],
  ];
  for (const [type, listener] of listeners) canvas.addEventListener(type, listener as EventListener);

  let colorTime = 0;
  let colorIndex = 0;
  let announced = COLORWAYS[0];
  onColorway(announced);
  function startReprint() {
    const current = COLORWAYS[colorIndex];
    const next = COLORWAYS[(colorIndex + 1) % COLORWAYS.length];
    for (const [role, { uniforms }] of materials) {
      uniforms.uFrom.value.set(current.colors[role]);
      uniforms.uTo.value.set(next.colors[role]);
    }
  }
  startReprint();
  const [, modelHeight] = model.manifest.size;
  const scanReach = modelHeight / 2 + 3;

  // The screen shows a placeholder until the photo reel loads, if it does.
  let reel: Reel | null = null;
  let reelIndex = 0;
  let reelClock = PHOTO_FADE_SECONDS;
  let disposed = false;
  loadReel(models.reel)
    .then((loaded) => {
      if (disposed) return;
      reel = loaded;
      screen.showPhoto(loaded, 0, 0, 0);
    })
    .catch(() => {});


  let last = performance.now();
  let frame = 0;
  let visible = true;

  function render(now: number) {
    frame = requestAnimationFrame(render);
    const dt = Math.min(Math.max(now - last, 0) / 1000, 1 / 20);
    last = now;

    const target = hovered || pinned ? 1 : 0;
    if (introDelay > 0) {
      introDelay -= dt;
    } else {
      const step = dt / (reducedMotion ? 0.25 : EXPLODE_SECONDS);
      explode = target > explode ? Math.min(target, explode + step) : Math.max(target, explode - step);
    }
    for (const { group, offset, delay, turns } of units) {
      const t = easeInOutCubic(clamp01((explode - delay) / (1 - MAX_DELAY)));
      group.position.set(offset[0] * t, offset[1] * t, offset[2] * t);
      if (turns) for (const holder of group.children) holder.children[0].rotation.y = t * turns * Math.PI * 2;
    }
    const exploded = easeInOutCubic(explode);

    if (!drag) {
      velocity *= Math.exp(-dt * 2.5);
      const spin = reducedMotion ? 0 : ASSEMBLED_SPIN + (EXPLODED_SPIN - ASSEMBLED_SPIN) * exploded;
      angle += (spin + velocity) * dt;
    }
    spinner.rotation.y = angle;
    spinner.position.y = reducedMotion ? 0 : Math.sin(now / 1400) * 1.2;

    if (!reducedMotion) {
      // Swap in the next pair of colours before placing the scan line, so the
      // frame a reprint finishes never shows the following colorway.
      colorTime += dt;
      const { current, next, progress } = colorwayCycle(colorTime);
      if (current !== colorIndex) {
        colorIndex = current;
        startReprint();
      }
      const edge = progress > 0 ? (progress * 2 - 1) * scanReach : -1e4;
      const glow = Math.sin(Math.PI * progress) ** 0.5 * 1.4;
      for (const { uniforms } of materials.values()) {
        uniforms.uEdge.value = edge;
        uniforms.uGlow.value = glow;
      }
      if (progress > 0.5 && announced !== COLORWAYS[next]) {
        announced = COLORWAYS[next];
        onColorway(announced);
      }
    }

    pivot.lerpVectors(together.centre, apart.centre, exploded);
    assembly.position.set(-pivot.x, 0, -pivot.z);
    shadow.scale.setScalar(1 + 0.5 * exploded);
    if (reel && !reducedMotion) {
      reelClock += dt;
      if (reelClock >= PHOTO_SECONDS) {
        reelClock -= PHOTO_SECONDS;
        reelIndex = (reelIndex + 1) % reel.styles.length;
      }
      if (reelClock < PHOTO_FADE_SECONDS + dt) {
        const previous = (reelIndex + reel.styles.length - 1) % reel.styles.length;
        screen.showPhoto(reel, previous, reelIndex, clamp01(reelClock / PHOTO_FADE_SECONDS));
      }
    }

    // Back off until the spinning footprint fits across and the tilted view of
    // its height fits top to bottom.
    const reach = together.reach + (apart.reach - together.reach) * exploded;
    const halfHeight = together.halfHeight + (apart.halfHeight - together.halfHeight) * exploded;
    const halfFov = ((FOV / 2) * Math.PI) / 180;
    const across = reach / Math.sin(Math.atan(Math.tan(halfFov) * camera.aspect));
    const tall = (halfHeight * Math.cos(ELEVATION) + reach * Math.sin(ELEVATION)) / Math.sin(halfFov);
    const distance = Math.max(across, tall);
    const lookY = pivot.y / 100;
    camera.position.set(0, lookY + Math.sin(ELEVATION) * distance, Math.cos(ELEVATION) * distance);
    camera.lookAt(0, lookY, 0);

    renderer.render(scene, camera);
  }

  const intersectionObserver = new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting === visible) return;
    visible = entry.isIntersecting;
    cancelAnimationFrame(frame);
    if (visible) {
      last = performance.now();
      frame = requestAnimationFrame(render);
    }
  });
  intersectionObserver.observe(canvas);
  frame = requestAnimationFrame(render);

  return {
    setPinned(value) {
      pinned = value;
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      for (const [type, listener] of listeners) canvas.removeEventListener(type, listener as EventListener);
      dispose();
    },
  };
}

// Builds the home-page camera model from the CAD exports.
//
//   pnpm model:build                    enclosure: hardware/stl → public/models/muse-cam.bin
//   pnpm model:build <full-camera.3mf>  also rebuilds public/models/muse-cam-internals.bin
//
// The internals (Pi, PiSugar, battery, camera module, screen stand-in) come from
// a Fusion 3MF export of the whole assembled design, visible bodies only. That
// export contains vendor models, so it is not committed; only the simplified
// meshes written here are. Extracting it needs the `unzip` command.
//
// File layout: "MCAM", u32 JSON length, JSON manifest (space-padded to 4 bytes),
// then per part Int16 xyz positions, Int8 xyz normals and Uint16 indices, each
// 4-byte aligned. Positions are in Three.js axes (Y up, Z toward the viewer),
// centred on manifest.origin and multiplied by manifest.scale to get millimetres.
// Both files share the enclosure's origin and scale.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { MeshoptSimplifier } from "meshoptimizer";
import { BufferAttribute, BufferGeometry } from "three";
import { toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const here = dirname(fileURLToPath(import.meta.url));
const stlDir = join(here, "../../hardware/stl");
const modelDir = join(here, "../public/models");
const ENCLOSURE = ["body_main", "body_front", "door_side", "door_top", "lens_back", "lens_front"];
// Adjacent faces closer than this are shaded smoothly (curved walls, fillets).
const CREASE_ANGLE = (35 * Math.PI) / 180;
// Largest deviation, in millimetres, allowed when simplifying the internals, and
// the size below which internal bodies (markings, tiny passives) are dropped.
const SIMPLIFY_ERROR = 0.06;
const MIN_BODY_SIZE = 1.2;

// Internal bodies belong to the first CAD-space box (mm) that fully contains
// them. The camera module rides with the lens back it is mounted to. Bodies in
// no box, such as the reference standoffs, are skipped and listed.
const INTERNAL_UNITS = [
  { unit: "lens_back", min: [55, 55.5, 18], max: [85, 67, 46] },
  { unit: "pi", min: [0, 18.5, 0], max: [112, 38.2, 70] },
  { unit: "pisugar", min: [0, 36, 0], max: [112, 45.5, 70] },
  { unit: "battery", min: [0, 40, 0], max: [112, 54, 70] },
];
const BOARD_GREEN = "#1f6f43";
const BLACK = "#1b1b1d";
const SILVER = "#b9bcc0";
const GOLD = "#c9a54a";
const WHITE = "#ece9e2";
// Colours drawn as metal. The vendor models' grey is mostly connector shells and shields.
const METALS = new Set(["#a0a0a0", SILVER, GOLD]);

// Vendor models use grey as a placeholder colour for some parts. Each rule
// recolours those faces on bodies of a unit whose CAD size (mm) matches.
const RECOLOURS = [
  // The Raspberry Pi's board layers.
  { unit: "pi", matches: ([x, , z]) => x > 80 && z > 50, from: ["#a0a0a0", "#7f7f7f"], to: BOARD_GREEN },
  // Camera Module 3's lens barrel and holder, centred on the lens axis.
  { unit: "lens_back", matches: ([x, , z]) => x > 8 && x < 12 && z > 8 && z < 12, from: ["#a0a0a0", "#ffff87"], to: "#161617" },
];

// The PiSugar model is a single grey solid. Its circuit board is the 1 mm slab
// between these CAD Y planes; everything standing on either side of it is
// split into connected parts and coloured by size (x × height × z, mm).
const PISUGAR_BOARD = [38.13, 39.13];
function pisugarPartColour([x, height, z]) {
  if (Math.max(x, z) < 2.5) return height > 1.5 ? GOLD : WHITE; // pogo pins; LEDs
  if (Math.abs(x - 14) < 0.3 && Math.abs(z - 14) < 0.3) return SILVER; // magnet that holds the battery
  if (height > 5) return WHITE; // battery connector
  if (Math.abs(x - 5.5) < 0.2 && Math.abs(z - 5.5) < 0.2) return SILVER; // standoffs
  if (x > 7.2 && x < 9.5 && z > 6 && z < 9) return SILVER; // USB-C socket and switch
  return BLACK; // chips, inductors and modules
}
// The printed parts come from hardware/stl, and the page draws its own screen glass.
const EXPORT_SKIP = new Set(["Main Body", "Front Body PCM3", "Door Top", "Door Side", "Lens Back PCM3", "Lens Front PCM3", "Glass"]);

// CAD axes: +X right, +Y out of the lens, -Z up.
const toThree = (x, y, z) => [x, -z, y];

function readStl(name) {
  const bytes = readFileSync(join(stlDir, `${name}.stl`));
  const triangles = bytes.readUInt32LE(80);
  if (bytes.length !== 84 + triangles * 50) throw new Error(`${name}.stl is not a binary STL`);
  const positions = new Float32Array(triangles * 9);
  for (let t = 0; t < triangles; t++) {
    for (let v = 0; v < 3; v++) {
      const offset = 84 + t * 50 + 12 + v * 12;
      positions.set(toThree(bytes.readFloatLE(offset), bytes.readFloatLE(offset + 4), bytes.readFloatLE(offset + 8)), t * 9 + v * 3);
    }
  }
  return positions;
}

function read3mf(path) {
  const xml = execFileSync("unzip", ["-p", path, "3D/3dmodel.model"], { maxBuffer: 1 << 30 }).toString();
  if (!/unit="millimeter"/.test(xml)) throw new Error("Expected a 3MF exported in millimetres");
  const colourGroups = new Map();
  for (const [, id, body] of xml.matchAll(/<m:colorgroup id="(\d+)">([\s\S]*?)<\/m:colorgroup>/g)) {
    colourGroups.set(id, [...body.matchAll(/color="#([0-9A-Fa-f]{6})/g)].map((match) => `#${match[1].toLowerCase()}`));
  }
  const bodies = [];
  for (const [, attributes, body] of xml.matchAll(/<object ([^>]*)>([\s\S]*?)<\/object>/g)) {
    const attribute = (key) => attributes.match(new RegExp(`\\b${key}="([^"]*)"`))?.[1];
    const vertices = [];
    for (const [, x, y, z] of body.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"/g)) vertices.push(+x, +y, +z);
    const triangles = [];
    for (const [, a, b, c, pid, p1] of body.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"(?: pid="(\d+)")?(?: p1="(\d+)")?/g)) {
      const colour = colourGroups.get(pid ?? attribute("pid"))?.[+(p1 ?? attribute("pindex") ?? 0)] ?? "#a0a0a0";
      triangles.push({ indices: [+a, +b, +c], colour });
    }
    bodies.push({ name: attribute("name"), vertices, triangles });
  }
  return bodies;
}

function bounds(vertices) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < vertices.length; i++) {
    min[i % 3] = Math.min(min[i % 3], vertices[i]);
    max[i % 3] = Math.max(max[i % 3], vertices[i]);
  }
  return { min, max };
}

// The battery's matching magnet is a 14 mm disc standing 2 mm proud of its face
// toward the PiSugar, between these CAD Y planes; the rest of it is black.
const BATTERY_MAGNET = [41.1, 43.1];
function batteryColours(body) {
  return body.triangles.map(({ indices }) => {
    const ys = indices.map((i) => body.vertices[i * 3 + 1]);
    const inDisc = Math.max(...ys) <= BATTERY_MAGNET[1] + 1e-3 && Math.min(...ys) < BATTERY_MAGNET[1] - 1e-3;
    return inDisc ? SILVER : BLACK;
  });
}

// Colours each PiSugar triangle: the board green, the parts on it by size.
function pisugarColours(body) {
  const y = (index) => body.vertices[index * 3 + 1];
  const onBoard = ({ indices }) => indices.every((i) => y(i) >= PISUGAR_BOARD[0] - 1e-3 && y(i) <= PISUGAR_BOARD[1] + 1e-3);
  const key = (i) => `${body.vertices[i * 3]},${y(i)},${body.vertices[i * 3 + 2]}`;
  const parent = new Map();
  const find = (k) => {
    while (parent.get(k) !== k) k = parent.get(k);
    return k;
  };
  const union = (a, b) => {
    const [rootA, rootB] = [find(a), find(b)];
    if (rootA !== rootB) parent.set(rootA, rootB);
  };
  const parts = body.triangles.filter((triangle) => !onBoard(triangle));
  for (const { indices } of parts) for (const i of indices) if (!parent.has(key(i))) parent.set(key(i), key(i));
  for (const { indices } of parts) {
    union(key(indices[0]), key(indices[1]));
    union(key(indices[1]), key(indices[2]));
  }
  const islands = new Map();
  for (const triangle of parts) {
    const root = find(key(triangle.indices[0]));
    if (!islands.has(root)) islands.set(root, []);
    islands.get(root).push(triangle);
  }
  const colours = new Map();
  for (const triangles of islands.values()) {
    const { min, max } = bounds(triangles.flatMap(({ indices }) => indices.flatMap((i) => [body.vertices[i * 3], y(i), body.vertices[i * 3 + 2]])));
    const colour = pisugarPartColour(max.map((value, axis) => value - min[axis]));
    for (const triangle of triangles) colours.set(triangle, colour);
  }
  return body.triangles.map((triangle) => colours.get(triangle) ?? BOARD_GREEN);
}

function internalUnit(body, { min, max }) {
  if (/^Screen Body/.test(body.name)) return "screen";
  return INTERNAL_UNITS.find((box) => [0, 1, 2].every((a) => min[a] >= box.min[a] && max[a] <= box.max[a]))?.unit;
}

// Merges the internal bodies into one simplified mesh per unit and colour.
function readInternals(path) {
  const buckets = new Map();
  const skipped = [];
  let tiny = 0;
  for (const body of read3mf(path)) {
    if (EXPORT_SKIP.has(body.name)) continue;
    const box = bounds(body.vertices);
    const unit = internalUnit(body, box);
    if (!unit) {
      skipped.push(body.name);
      continue;
    }
    const size = box.max.map((value, axis) => value - box.min[axis]);
    if (Math.max(...size) < MIN_BODY_SIZE) {
      tiny++;
      continue;
    }
    const recolours = RECOLOURS.filter((rule) => rule.unit === unit && rule.matches(size));
    const painted = unit === "pisugar" ? pisugarColours(body) : unit === "battery" ? batteryColours(body) : null;
    for (const [t, { indices, colour: original }] of body.triangles.entries()) {
      const colour = painted?.[t] ?? recolours.find((rule) => rule.from.includes(original))?.to ?? original;
      const key = `${unit} ${colour}`;
      if (!buckets.has(key)) buckets.set(key, { unit, colour, positions: [], indices: [], welded: new Map() });
      const bucket = buckets.get(key);
      // Weld by position so the simplifier sees connected surfaces.
      for (const index of indices) {
        const x = body.vertices[index * 3];
        const y = body.vertices[index * 3 + 1];
        const z = body.vertices[index * 3 + 2];
        const key = `${x},${y},${z}`;
        let welded = bucket.welded.get(key);
        if (welded === undefined) {
          welded = bucket.positions.length / 3;
          bucket.welded.set(key, welded);
          bucket.positions.push(x, y, z);
        }
        bucket.indices.push(welded);
      }
    }
  }
  if (skipped.length) console.log(`Skipped bodies outside every internal unit: ${skipped.join(", ")}`);
  console.log(`Dropped ${tiny} bodies smaller than ${MIN_BODY_SIZE} mm`);

  return [...buckets.values()].map(({ unit, colour, positions, indices }) => {
    const source = new Float32Array(positions);
    const [simplified] = MeshoptSimplifier.simplify(Uint32Array.from(indices), source, 3, 0, SIMPLIFY_ERROR, ["ErrorAbsolute", "Prune"]);
    const triangles = new Float32Array(simplified.length * 3);
    simplified.forEach((index, i) => triangles.set(toThree(source[index * 3], source[index * 3 + 1], source[index * 3 + 2]), i * 3));
    return { name: `${unit} ${colour}`, unit, colour, metal: METALS.has(colour), positions: triangles, sourceTriangles: indices.length / 3 };
  });
}

function writeModel(file, parts, frame) {
  const chunks = [];
  let byteOffset = 0;
  function append(typedArray) {
    const start = byteOffset;
    const bytes = new Uint8Array(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
    const padded = new Uint8Array(Math.ceil(bytes.length / 4) * 4);
    padded.set(bytes);
    chunks.push(padded);
    byteOffset += padded.length;
    return start;
  }

  const manifest = { ...frame, parts: [] };
  for (const { name, unit, colour, metal, positions } of parts) {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    const creased = toCreasedNormals(geometry, CREASE_ANGLE);
    const p = creased.getAttribute("position");
    const n = creased.getAttribute("normal");

    const lookup = new Map();
    const qPositions = [];
    const qNormals = [];
    const indices = [];
    for (let i = 0; i < p.count; i++) {
      const vertex = [
        Math.round((p.getX(i) - frame.origin[0]) / frame.scale),
        Math.round((p.getY(i) - frame.origin[1]) / frame.scale),
        Math.round((p.getZ(i) - frame.origin[2]) / frame.scale),
        Math.round(n.getX(i) * 127),
        Math.round(n.getY(i) * 127),
        Math.round(n.getZ(i) * 127),
      ];
      if (vertex.slice(0, 3).some((value) => Math.abs(value) > 32767)) throw new Error(`${name} extends outside the enclosure`);
      const key = vertex.join(",");
      let index = lookup.get(key);
      if (index === undefined) {
        index = lookup.size;
        lookup.set(key, index);
        qPositions.push(...vertex.slice(0, 3));
        qNormals.push(...vertex.slice(3));
      }
      indices.push(index);
    }
    if (lookup.size > 65535) throw new Error(`${name} has too many vertices for Uint16 indices`);

    manifest.parts.push({
      name,
      unit,
      ...(colour ? { colour } : {}),
      ...(metal ? { metal } : {}),
      vertexCount: lookup.size,
      indexCount: indices.length,
      positionOffset: append(Int16Array.from(qPositions)),
      normalOffset: append(Int8Array.from(qNormals)),
      indexOffset: append(Uint16Array.from(indices)),
    });
  }

  let json = JSON.stringify(manifest);
  json += " ".repeat((4 - (json.length % 4)) % 4);
  const header = Buffer.alloc(8);
  header.write("MCAM", 0, "ascii");
  header.writeUInt32LE(json.length, 4);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, Buffer.concat([header, Buffer.from(json, "ascii"), ...chunks]));
  const triangles = manifest.parts.reduce((sum, part) => sum + part.indexCount / 3, 0);
  console.log(`Wrote ${file} (${((8 + json.length + byteOffset) / 1024).toFixed(0)} KB, ${manifest.parts.length} parts, ${triangles} triangles)`);
}

const enclosure = ENCLOSURE.map((name) => ({ name, unit: name, positions: readStl(name) }));
const min = [Infinity, Infinity, Infinity];
const max = [-Infinity, -Infinity, -Infinity];
for (const { positions } of enclosure) {
  for (let i = 0; i < positions.length; i++) {
    min[i % 3] = Math.min(min[i % 3], positions[i]);
    max[i % 3] = Math.max(max[i % 3], positions[i]);
  }
}
const origin = min.map((value, axis) => (value + max[axis]) / 2);
const frame = {
  scale: Math.max(...max.map((value, axis) => value - origin[axis])) / 32000,
  origin,
  size: max.map((value, axis) => value - min[axis]),
};
writeModel(join(modelDir, "muse-cam.bin"), enclosure, frame);

const exportPath = process.argv[2];
if (exportPath) {
  await MeshoptSimplifier.ready;
  const internals = readInternals(resolve(process.env.INIT_CWD ?? process.cwd(), exportPath));
  for (const part of internals) {
    console.log(`  ${part.name.padEnd(18)} ${part.sourceTriangles} → ${part.positions.length / 9} triangles`);
  }
  writeModel(join(modelDir, "muse-cam-internals.bin"), internals, frame);
}

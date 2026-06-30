/**
 * The building's **full measured LoD2 solid in 3D** — roof, wall and ground surfaces served by
 * `linked-lod2-by` (Bayerische Vermessungsverwaltung), rendered in a Three.js viewer with
 * orbit/zoom + Leaflet-style +/- buttons. The 3D sibling of the 2-D {@link ./RoofPlan.tsx}: where
 * that shows the roof faces top-down, this shows the whole building shape. Sits in the building
 * header's right column beside/below the {@link ../LocatorMap.tsx} (matched 360×240 footprint);
 * degrades to nothing outside the dump's coverage (the hook returns null / no geometry).
 *
 * Geometry is the wrapper's faithful native ETRS89/UTM32N `POLYGON Z` (metric, orthogonal), so it
 * is rendered directly in metres — no reprojection. Triangulation is concave-safe (Newell normal +
 * plane basis + `THREE.ShapeUtils`), ported from the wrapper's own `building.js` viewer.
 */
import { useEffect, useRef } from "react";
import { Box, IconButton, Stack, Typography } from "@mui/material";
import ViewInArIcon from "@mui/icons-material/ViewInAr";
import AddIcon from "@mui/icons-material/Add";
import RemoveIcon from "@mui/icons-material/Remove";
import ExploreIcon from "@mui/icons-material/Explore";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Building } from "../../types.ts";
import { msg } from "../../lib/messages.ts";
import { RdfSourceLink } from "../detail/DetailView.tsx";
import { useBuilding3d } from "../../hooks/lod2Rooftop.ts";
import type { Surface3d } from "../../services/sources/lod2Rooftop.ts";

const COLOR: Record<Surface3d["kind"], number> = {
  roof: 0xe67e22,
  wall: 0xd8dde1,
  ground: 0x7f8c8d,
};
// Sized to match the sibling LocatorMap (360 × 240 from sm), so the 3D model sits beside the
// building's location map at the same footprint.
const VIEW_H = 240;

/** Triangulate a planar 3D ring (concave-safe) → flat [x,y,z, …] triangle positions. */
function triangulate(ring: [number, number, number][]): number[] {
  const pts = ring.slice();
  const a = pts[0], b = pts[pts.length - 1];
  if (b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2]) pts.pop(); // drop closing dup
  if (pts.length < 3) return [];
  let nx = 0, ny = 0, nz = 0; // Newell normal
  for (let i = 0; i < pts.length; i++) {
    const c = pts[i], n = pts[(i + 1) % pts.length];
    nx += (c[1] - n[1]) * (c[2] + n[2]);
    ny += (c[2] - n[2]) * (c[0] + n[0]);
    nz += (c[0] - n[0]) * (c[1] + n[1]);
  }
  const nl = Math.hypot(nx, ny, nz) || 1;
  nx /= nl;
  ny /= nl;
  nz /= nl;
  const ref: [number, number, number] =
    (Math.abs(nx) <= Math.abs(ny) && Math.abs(nx) <= Math.abs(nz))
      ? [1, 0, 0]
      : (Math.abs(ny) <= Math.abs(nz))
      ? [0, 1, 0]
      : [0, 0, 1];
  const dp = ref[0] * nx + ref[1] * ny + ref[2] * nz;
  let ux = ref[0] - dp * nx, uy = ref[1] - dp * ny, uz = ref[2] - dp * nz;
  const ul = Math.hypot(ux, uy, uz) || 1;
  ux /= ul;
  uy /= ul;
  uz /= ul;
  const vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;
  const flat = pts.map((p) =>
    new THREE.Vector2(
      p[0] * ux + p[1] * uy + p[2] * uz,
      p[0] * vx + p[1] * vy + p[2] * vz,
    )
  );
  const faces = THREE.ShapeUtils.triangulateShape(flat, []);
  const out: number[] = [];
  for (const f of faces) {
    for (const idx of f) out.push(pts[idx][0], pts[idx][1], pts[idx][2]);
  }
  return out;
}

/** Build a centred Three.js group from the surfaces (in their own UTM metres, shifted to a local
 *  origin for float32 precision; Y is elevation, the base sits on y=0). */
function buildGroup(
  surfaces: Surface3d[],
): {
  group: THREE.Group;
  size: THREE.Vector3;
  disposables: THREE.BufferGeometry[];
} {
  let ox = Infinity, oy = Infinity, oz = Infinity;
  for (const s of surfaces) {
    for (const p of s.ring) {
      if (p[0] < ox) ox = p[0];
      if (p[1] < oy) oy = p[1];
      if (p[2] < oz) oz = p[2];
    }
  }
  const group = new THREE.Group();
  const disposables: THREE.BufferGeometry[] = [];
  for (const s of surfaces) {
    // native UTM [easting, northing, elev] → scene [x=East, y=Up=elev, z=−North]. Negating the
    // northing makes this a proper right-handed rotation (not a reflection): without it [E,Up,N]
    // is left-handed and the building renders MIRRORED north↔south. So North is −Z here.
    const local = s.ring.map((
      p,
    ): [number, number, number] => [p[0] - ox, p[2] - oz, -(p[1] - oy)]);
    const pos = triangulate(local);
    if (pos.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.computeVertexNormals();
      disposables.push(geo);
      group.add(
        new THREE.Mesh(
          geo,
          new THREE.MeshLambertMaterial({
            color: COLOR[s.kind],
            side: THREE.DoubleSide,
            flatShading: true,
          }),
        ),
      );
    }
    const edge = new THREE.BufferGeometry().setFromPoints(
      local.map((p) => new THREE.Vector3(p[0], p[1], p[2])),
    );
    disposables.push(edge);
    group.add(
      new THREE.LineLoop(
        edge,
        new THREE.LineBasicMaterial({ color: 0x2c3e50 }),
      ),
    );
  }
  const bbox = new THREE.Box3().setFromObject(group);
  const ctr = bbox.getCenter(new THREE.Vector3());
  const size = bbox.getSize(new THREE.Vector3());
  group.position.set(-ctr.x, -bbox.min.y, -ctr.z); // base on y=0, centred in x/z
  return { group, size, disposables };
}

export default function Building3DViewer({ building }: { building: Building }) {
  const data = useBuilding3d(building).data ?? null;
  const surfaces = data?.surfaces ?? null;
  const mountRef = useRef<HTMLDivElement | null>(null);
  // Imperative handles set inside the effect (camera/controls live in its closure).
  const zoomRef = useRef<(factor: number) => void>(() => {});
  const resetRef = useRef<() => void>(() => {});

  useEffect(() => {
    const el = mountRef.current;
    if (!el || !surfaces || surfaces.length === 0) return;
    const w = el.clientWidth || 600;
    const h = el.clientHeight || VIEW_H;

    const { group, size, disposables } = buildGroup(surfaces);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xeaf0f4);
    scene.add(group);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x556677, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(size.x, size.y * 2 + 10, size.z * 0.6);
    scene.add(sun);
    // Plain grid (no emphasised centre line — the coloured principal cross below carries it).
    const gridSpan = Math.max(size.x, size.z) * 3 || 20;
    const grid = new THREE.GridHelper(gridSpan, 24, 0xd2dadf, 0xd2dadf);
    scene.add(grid);

    // The grid's two main axes coloured as the compass cross: North arm (−Z) red, South arm (+Z)
    // grey, East–West (±X) blue — so the N-S/E-W alignment (and which way is north) is read off
    // the wireframe itself rather than a separate arrow.
    const axis = (a: THREE.Vector3, b: THREE.Vector3, color: number) => {
      const g = new THREE.BufferGeometry().setFromPoints([a, b]);
      disposables.push(g);
      return new THREE.Line(g, new THREE.LineBasicMaterial({ color }));
    };
    const ext = gridSpan / 2;
    const yA = 0.05; // lift off the grid plane to avoid z-fighting
    scene.add(
      axis(
        new THREE.Vector3(0, yA, 0),
        new THREE.Vector3(0, yA, -ext),
        0xd32f2f,
      ),
    ); // N
    scene.add(
      axis(
        new THREE.Vector3(0, yA, 0),
        new THREE.Vector3(0, yA, ext),
        0x9aa7b0,
      ),
    ); // S
    scene.add(
      axis(
        new THREE.Vector3(-ext, yA, 0),
        new THREE.Vector3(ext, yA, 0),
        0x3a6ea5,
      ),
    ); // E-W

    // Default view: straight over the building (near top-down). North is −Z, so a slight +Z
    // (southward) offset keeps north reading up and the camera off-vertical (no gimbal). Saved as
    // the home state for the re-center button.
    const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 10000);
    const d = Math.max(size.x, size.y, size.z) * 1.8 + 10;
    camera.position.set(0, d * 1.3, d * 0.08);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(globalThis.devicePixelRatio ?? 1);
    renderer.setSize(w, h);
    el.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, size.y / 2, 0);
    controls.update();
    controls.saveState(); // home = this north-up framing + zoom 1 (for controls.reset())

    // Smooth (eased) zoom — animate camera.zoom over ~300 ms with a cubic ease-in-out, the
    // accel/decel feel of Leaflet's animated zoom. camera.zoom is independent of the damped
    // orbit state (setting camera.position would be reverted each frame), so it sticks.
    const easeInOut = (t: number) =>
      t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
    const ZOOM_MS = 300;
    let zoomFrom = camera.zoom,
      zoomTo = camera.zoom,
      zoomT0 = 0,
      zooming = false;
    const zoomBy = (factor: number) => {
      zoomFrom = camera.zoom;
      zoomTo = Math.max(0.25, Math.min(8, zoomTo * factor));
      zoomT0 = performance.now();
      zooming = true;
    };
    zoomRef.current = zoomBy;
    resetRef.current = () => {
      controls.reset(); // restores the saved north-up position/target + zoom 1
      zoomFrom = zoomTo = camera.zoom;
      zooming = false;
    };
    // Double-click zooms in, like the Leaflet map.
    const onDblClick = (e: MouseEvent) => {
      e.preventDefault();
      zoomBy(1.6);
    };
    renderer.domElement.addEventListener("dblclick", onDblClick);

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (zooming) {
        const t = Math.min(1, (performance.now() - zoomT0) / ZOOM_MS);
        camera.zoom = zoomFrom + (zoomTo - zoomFrom) * easeInOut(t);
        camera.updateProjectionMatrix();
        if (t >= 1) zooming = false;
      }
      controls.update();
      renderer.render(scene, camera);
    };
    loop();

    const onResize = () => {
      const nw = el.clientWidth || w, nh = el.clientHeight || h;
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
    };
    globalThis.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      globalThis.removeEventListener("resize", onResize);
      renderer.domElement.removeEventListener("dblclick", onDblClick);
      controls.dispose();
      renderer.dispose();
      for (const g of disposables) g.dispose();
      grid.dispose();
      if (renderer.domElement.parentNode === el) {
        el.removeChild(renderer.domElement);
      }
      zoomRef.current = () => {};
      resetRef.current = () => {};
    };
  }, [surfaces]);

  if (!data || !surfaces || surfaces.length === 0) return null;

  const ctrlBtn = {
    bgcolor: "background.paper",
    "&:hover": { bgcolor: "grey.100" },
  } as const;

  return (
    <Stack spacing={0.5}>
      <Box
        role="img"
        aria-label={msg("b3dTitle")}
        title={msg("b3dHint")}
        sx={{
          position: "relative",
          width: { xs: "100%", sm: 360 },
          height: VIEW_H,
          borderRadius: 1,
          overflow: "hidden",
          boxShadow: 1,
          "& canvas": { display: "block", width: "100%", height: "100%" },
        }}
      >
        <Box ref={mountRef} sx={{ width: "100%", height: "100%" }} />
        {/* Top-left controls (Leaflet placement): zoom +/- then a north-up re-center. */}
        <Stack sx={{ position: "absolute", top: 8, left: 8, gap: 0.5 }}>
          <Stack sx={{ boxShadow: 1, borderRadius: 1, overflow: "hidden" }}>
            <IconButton
              size="small"
              aria-label="zoom in"
              onClick={() => zoomRef.current(1.6)}
              sx={ctrlBtn}
            >
              <AddIcon fontSize="small" />
            </IconButton>
            <IconButton
              size="small"
              aria-label="zoom out"
              onClick={() => zoomRef.current(0.625)}
              sx={ctrlBtn}
            >
              <RemoveIcon fontSize="small" />
            </IconButton>
          </Stack>
          <IconButton
            size="small"
            aria-label="reset view (north up)"
            title={msg("b3dReset")}
            onClick={() => resetRef.current()}
            sx={{ ...ctrlBtn, boxShadow: 1, borderRadius: 1 }}
          >
            <ExploreIcon fontSize="small" />
          </IconButton>
        </Stack>
        {/* Subtle label, bottom-left (top-left now holds the controls). */}
        <Stack
          direction="row"
          spacing={0.5}
          sx={{
            position: "absolute",
            bottom: 6,
            left: 8,
            alignItems: "center",
            color: "text.secondary",
            bgcolor: "rgba(255,255,255,0.75)",
            borderRadius: 1,
            px: 0.5,
          }}
        >
          <ViewInArIcon fontSize="small" />
          <Typography variant="caption">{msg("b3dTitle")}</Typography>
        </Stack>
      </Box>
      {/* Dev-mode blue link to the lod2-by resource the model came from. */}
      <RdfSourceLink href={data.iri} />
    </Stack>
  );
}

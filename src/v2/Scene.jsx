import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import {
  mergeModels,
  thematicModel,
  vectorLines,
  vectorSurfaces,
} from "./model.mjs";
import { colorAt } from "./terrain-mesh.mjs";
import { classifyLayer, colorCSS } from "./layers.mjs";
import { stats } from "./raster-grid.mjs";
export default function Scene({
  model,
  style,
  layers,
  onPick,
  onReady,
  selection,
}) {
  const host = useRef(null),
    state = useRef(null),
    pick = useRef(onPick);
  pick.current = onPick;
  useEffect(() => {
    const el = host.current,
      scene = new THREE.Scene();
    scene.background = new THREE.Color("#eae9ef");
    const camera = new THREE.PerspectiveCamera(38, 1, 10, 100000);
    camera.up.set(0, 0, 1);
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        preserveDrawingBuffer: true,
      });
    } catch (e) {
      el.textContent = "WebGL unavailable: " + e.message;
      return;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.setClearColor("#eae9ef");
    el.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI * 0.49;
    scene.add(new THREE.AmbientLight(0xffffff, 1.7));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-1000, -2000, 5000);
    scene.add(sun);
    const group = new THREE.Group();
    scene.add(group);
    const ray = new THREE.Raycaster(),
      mouse = new THREE.Vector2();
    let down;
    const pointerdown = (e) => {
        down = [e.clientX, e.clientY];
      },
      click = (e) => {
        if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4)
          return;
        const rect = el.getBoundingClientRect();
        mouse.set(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          (-(e.clientY - rect.top) / rect.height) * 2 + 1,
        );
        ray.setFromCamera(mouse, camera);
        const hits = ray
          .intersectObjects(group.children)
          .filter((h) => h.object.userData.pickGrid);
        if (hits[0] && state.current.model) {
          const p = group.worldToLocal(hits[0].point.clone()),
            g = state.current.model.grid,
            x = Math.floor(p.x / g.size),
            y = Math.floor(p.y / g.size);
          if (x >= 0 && x < g.cols && y >= 0 && y < g.rows)
            pick.current?.(y * g.cols + x);
        }
      };
    renderer.domElement.addEventListener("pointerdown", pointerdown);
    renderer.domElement.addEventListener("click", click);
    state.current = { renderer, scene, camera, controls, group, model: null };
    const resize = () => {
      const w = el.clientWidth,
        h = el.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      group.traverse((o) => {
        if (o.material?.resolution) o.material.resolution.set(w, h);
      });
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    let frame;
    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    };
    animate();
    onReady?.({
      png: () => renderer.domElement.toDataURL("image/png"),
      fit: () => {
        const m = state.current?.model;
        if (m) {
          const w = m.grid.cols * m.grid.size,
            h = m.grid.rows * m.grid.size;
          controls.target.set(w / 2, h / 2, 0);
          camera.position.set(w * 0.6, -h * 0.65, Math.max(w, h) * 1.3);
          controls.update();
        }
      },
      top: () => {
        const m = state.current?.model;
        if (m) {
          const w = m.grid.cols * m.grid.size,
            h = m.grid.rows * m.grid.size;
          controls.target.set(w / 2, h / 2, 0);
          camera.position.set(w / 2, h / 2 - 0.1, Math.max(w, h) * 1.7);
          controls.update();
        }
      },
    });
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      group.traverse((o) => {
        o.geometry?.dispose();
        o.material?.map?.dispose();
        o.material?.dispose();
      });
      renderer.domElement.remove();
      state.current = null;
    };
  }, []);
  useEffect(() => {
    const s = state.current;
    if (!s) return;
    const { group, camera, controls } = s;
    while (group.children.length) {
      const o = group.children[0];
      o.geometry?.dispose();
      o.material?.map?.dispose();
      o.material?.dispose();
      group.remove(o);
    }
    if (!model) return;
    const first = s.model !== model;
    s.model = model;
    const { grid, terrain, lst, buildings } = model;
    const selectedSet = new Set(selection?.ids || []);
    const geometry = (m) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(m.positions, 3));
      if (m.colors)
        g.setAttribute("color", new THREE.BufferAttribute(m.colors, 3));
      if (m.uv) g.setAttribute("uv", new THREE.BufferAttribute(m.uv, 2));
      g.setIndex(new THREE.BufferAttribute(m.indices, 1));
      g.computeVertexNormals();
      return g;
    };
    const elevationLayer = layers.find((l) => l.id === grid.source),
      analysisLayer = layers.find((l) => l.id === lst?.source),
      imageLayer = layers.find((l) => l.role === "imagery");
    if (style.terrain && elevationLayer?.visible !== false) {
      const g = geometry(terrain),
        st = stats(grid.mean),
        terrainColours =
          elevationLayer?.symbology && classifyLayer(elevationLayer),
        colors = new Float32Array(terrain.positions.length);
      for (let i = 0; i < terrain.z.length; i++)
        colors.set(
          elevationLayer?.symbology
            ? terrainColours.color(terrain.z[i])
            : colorAt(terrain.z[i], st.min, st.max, "terrain"),
          i * 3,
        );
      g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      const m = new THREE.Mesh(
        g,
        new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 0.92,
          opacity: elevationLayer?.symbology?.opacity ?? 1,
          transparent: (elevationLayer?.symbology?.opacity ?? 1) < 1,
          side: THREE.DoubleSide,
        }),
      );
      m.userData.pickGrid = true;
      group.add(m);
    }
    if (style.lst && lst && analysisLayer?.visible !== false) {
      const m = new THREE.Mesh(
        geometry(
          thematicModel(
            lst,
            grid,
            terrain,
            style.ramp,
            style.min,
            style.max,
            analysisLayer?.symbology
              ? classifyLayer(analysisLayer).color
              : undefined,
          ),
        ),
        new THREE.MeshBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: style.opacity * (analysisLayer?.symbology?.opacity ?? 1),
          polygonOffset: true,
          polygonOffsetFactor: -3,
          polygonOffsetUnits: -3,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      m.userData.pickGrid = true;
      group.add(m);
    }
    if (style.imagery && model.texture && imageLayer?.visible !== false) {
      const tex = new THREE.DataTexture(
        model.texture.pixels,
        model.texture.width,
        model.texture.height,
      );
      tex.needsUpdate = true;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.flipY = true;
      const g = geometry(terrain);
      const m = new THREE.Mesh(
        g,
        new THREE.MeshBasicMaterial({
          map: tex,
          transparent: true,
          opacity: style.imageryOpacity * (imageLayer?.symbology?.opacity ?? 1),
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
          depthWrite: false,
        }),
      );
      group.add(m);
    }
    if (
      selection?.ids?.length &&
      ["grid", "lstgrid"].includes(selection.layer)
    ) {
      const mean = new Float32Array(grid.mean.length).fill(NaN);
      for (const k of selection.ids) mean[k] = 1;
      const selectedMesh = new THREE.Mesh(
        geometry(
          thematicModel({ ...grid, mean }, grid, terrain, "thermal", 0, 1),
        ),
        new THREE.MeshBasicMaterial({
          color: "#ffc957",
          transparent: true,
          opacity: 0.8,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -5,
          polygonOffsetUnits: -5,
          depthWrite: false,
        }),
      );
      group.add(selectedMesh);
    }
    if (selection?.ids?.length && style.buildings) {
      const selected = buildings.models.filter(
        (m) => m.layerId === selection.layer && selectedSet.has(m.featureIndex),
      );
      if (selected.length)
        group.add(
          new THREE.Mesh(
            geometry(mergeModels(selected)),
            new THREE.MeshBasicMaterial({
              color: "#e7b354",
              transparent: true,
              opacity: 0.8,
              polygonOffset: true,
              polygonOffsetFactor: -3,
              polygonOffsetUnits: -3,
            }),
          ),
        );
    }
    if (style.buildings) {
      for (const l of layers.filter(
        (l) => l.heightField && l.visible !== false,
      )) {
        const models = buildings.models.filter((m) => m.layerId === l.id),
          classified = classifyLayer(l),
          opacity = style.buildingOpacity * (l.symbology?.opacity ?? 1);
        // Opaque buildings batch efficiently; transparent objects sort separately.
        const batches = opacity < 1 ? models.map((m) => [m]) : [models];
        for (const batch of batches) {
          if (!batch.length) continue;
          const merged = mergeModels(batch),
            colors = new Float32Array(merged.positions.length);
          let offset = 0;
          for (const m of batch) {
            const c = classified.color(m.properties?.[l.symbology?.field]);
            for (let i = 0; i < m.positions.length / 3; i++)
              colors.set(c, offset + i * 3);
            offset += m.positions.length;
          }
          merged.colors = colors;
          group.add(
            new THREE.Mesh(
              geometry(merged),
              new THREE.MeshStandardMaterial({
                vertexColors: true,
                flatShading: true,
                roughness: 0.85,
                side: THREE.FrontSide,
                transparent: opacity < 1,
                opacity,
                depthWrite: opacity === 1,
              }),
            ),
          );
        }
      }
    }
    if (style.wire) {
      const p = [];
      for (const i of terrain.lines)
        p.push(
          terrain.positions[i * 3],
          terrain.positions[i * 3 + 1],
          terrain.positions[i * 3 + 2] + 0.2,
        );
      const geom = new LineSegmentsGeometry();
      geom.setPositions(p);
      const mat = new LineMaterial({
        color: style.wireColor,
        linewidth: style.wireWidth,
        transparent: true,
        opacity: style.wireOpacity,
        resolution: new THREE.Vector2(
          host.current.clientWidth,
          host.current.clientHeight,
        ),
      });
      group.add(new LineSegments2(geom, mat));
    }
    for (const line of vectorLines(
      layers.filter((l) => l.visible !== false),
      grid,
      terrain,
      selection,
    )) {
      const points = [];
      for (let i = 1; i < line.points.length; i++)
        points.push(...line.points[i - 1], ...line.points[i]);
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
      group.add(
        new THREE.LineSegments(
          g,
          new THREE.LineBasicMaterial({
            color: line.color
              ? colorCSS(line.color)
              : layers.find((l) => l.id === line.layerId)?.symbology
                  ?.outlineColor || "#7855a8",
            transparent: true,
            opacity:
              layers.find((l) => l.id === line.layerId)?.symbology?.opacity ??
              1,
          }),
        ),
      );
    }
    for (const layer of layers.filter(
      (l) => l.kind === "vector" && l.visible !== false,
    )) {
      const surfaces = vectorSurfaces(
        [layer],
        grid,
        terrain,
        selection?.layer === layer.id ? selection.ids : [],
      );
      if (surfaces.models.length) {
        const merged = mergeModels(surfaces.models),
          colors = new Float32Array(merged.positions.length);
        let offset = 0;
        for (const m of surfaces.models) {
          colors.set(m.colors, offset);
          offset += m.colors.length;
        }
        merged.colors = colors;
        group.add(
          new THREE.Mesh(
            geometry(merged),
            new THREE.MeshBasicMaterial({
              vertexColors: true,
              transparent: true,
              opacity: layer.symbology?.opacity ?? 0.75,
              side: THREE.DoubleSide,
              polygonOffset: true,
              polygonOffsetFactor: -4,
              polygonOffsetUnits: -4,
              depthWrite: false,
            }),
          ),
        );
      }
      if (surfaces.points.length) {
        const g = new THREE.BufferGeometry();
        g.setAttribute(
          "color",
          new THREE.Float32BufferAttribute(surfaces.pointColors, 3),
        );
        g.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(surfaces.points, 3),
        );
        group.add(
          new THREE.Points(
            g,
            new THREE.PointsMaterial({
              vertexColors: true,
              transparent: true,
              opacity: layer.symbology?.opacity ?? 1,
              size: 5,
              sizeAttenuation: false,
            }),
          ),
        );
      }
    }
    group.scale.z = style.zScale;
    if (first) {
      const w = grid.cols * grid.size,
        h = grid.rows * grid.size;
      controls.target.set(w / 2, h / 2, 0);
      camera.position.set(w * 0.6, -h * 0.65, Math.max(w, h) * 1.3);
      controls.update();
    }
  }, [model, style, layers, selection]);
  return (
    <div className="v2-scene" ref={host} aria-label="3D terrain viewport" />
  );
}

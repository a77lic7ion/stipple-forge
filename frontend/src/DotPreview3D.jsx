import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// TokenArt palette — same as the city renderer
const PALETTE = {
  ink: '#141413',
  glow: '#f3efe4',
  rust: '#d97757',
  teal: '#2f8f83',
  hull: '#1e262d',
};

function accentKey(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('hermes')) return 'rust';
  if (n.includes('openrouter') || n.includes('nous') || n.includes('gemini') || n.includes('ollama') || n.includes('mistral')) return 'teal';
  return 'ink';
}

/** Convert Stipple Forge dots [[x,z,r,g,b,size]] to Three.js points */
function dotsToPoints(dots) {
  const positions = new Float32Array(dots.length * 3);
  const colors = new Float32Array(dots.length * 3);
  const sizes = new Float32Array(dots.length);

  for (let i = 0; i < dots.length; i++) {
    const d = dots[i];
    positions[i * 3] = d[0];     // x
    positions[i * 3 + 1] = 0.1;  // y (slight offset above ground)
    positions[i * 3 + 2] = d[1]; // z
    colors[i * 3] = d[2];
    colors[i * 3 + 1] = d[3];
    colors[i * 3 + 2] = d[4];
    sizes[i] = Math.max(0.5, d[5] || 1.0);
  }
  return { positions, colors, sizes };
}

/** Create instanced quad geometry (same as TokenArt) */
function createDotGeometry() {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0,
  ], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
    0, 0, 1, 0, 1, 1, 0, 1,
  ], 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
}

/** Create dot material with CSS-pixel sizing */
function createDotMaterial(resolutionY) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uResolutionY: { value: resolutionY },
      uTime: { value: 0 },
      uPulse: { value: 0 }, // no ripple for preview
      uRippleRadius: { value: 0 },
      uRippleCycle: { value: 15 },
      uRippleTravel: { value: 6 },
      uRippleStrength: { value: 1.15 },
      uRippleColor: { value: new THREE.Color('#a9551f') },
    },
    vertexShader: `
      attribute vec3 instanceOffset;
      attribute vec3 instanceColor;
      attribute float instanceSize;
      varying vec3 vColor;
      varying vec2 vUv;
      uniform float uResolutionY;
      void main() {
        vColor = instanceColor;
        vUv = uv;
        vec4 viewPosition = modelViewMatrix * vec4(instanceOffset, 1.0);
        float worldPerPixel = 2.0 * abs(viewPosition.z) * tan(radians(16.0)) / uResolutionY;
        gl_PointSize = max(1.0, instanceSize / worldPerPixel);
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying vec2 vUv;
      void main() {
        float dist = length(vUv - vec2(0.5));
        if (dist > 0.5) discard;
        float alpha = 1.0 - smoothstep(0.3, 0.5, dist);
        gl_FragColor = vec4(vColor, alpha);
      }
    `,
  });
}

export default function DotPreview3D({ dots, width, height, mode = 'edge' }) {
  const canvasRef = useRef(null);
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);
  const meshRef = useRef(null);
  const [error, setError] = useState(null);

  useEffect(() =>
  {
    if (!dots || !dots.length || !canvasRef.current) return;

    try {
      // Dispose previous
      if (meshRef.current) {
        meshRef.current.geometry.dispose();
        meshRef.current.material.dispose();
        sceneRef.current.remove(meshRef.current);
        meshRef.current = null;
      }

      const canvas = canvasRef.current;
      const w = canvas.clientWidth || width || 600;
      const h = canvas.clientHeight || height || 400;

      // Renderer
      let renderer = rendererRef.current;
      if (!renderer || renderer.domElement !== canvas) {
        if (renderer) renderer.dispose();
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
        renderer.setSize(w, h);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        rendererRef.current = renderer;
      }

      // Scene
      let scene = sceneRef.current;
      if (!scene) {
        scene = new THREE.Scene();
        scene.background = new THREE.Color('#0e1116');
        sceneRef.current = scene;
      }

      // Camera — isometric
      let camera = cameraRef.current;
      if (!camera) {
        camera = new THREE.PerspectiveCamera(32, w / h, 0.1, 400);
        cameraRef.current = camera;
      }

      // Convert dots to points
      const { positions, colors, sizes } = dotsToPoints(dots);

      // Find bounds for framing
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (let i = 0; i < dots.length; i++) {
        const x = dots[i][0], z = dots[i][1];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      }
      const spreadX = maxX - minX || 1;
      const spreadZ = maxZ - minZ || 1;
      const maxSpread = Math.max(spreadX, spreadZ);

      // Create point cloud
      const geometry = createDotGeometry();
      geometry.setAttribute('instanceOffset', new THREE.InstancedBufferAttribute(positions, 3));
      geometry.setAttribute('instanceColor', new THREE.InstancedBufferAttribute(colors, 3));
      geometry.setAttribute('instanceSize', new THREE.InstancedBufferAttribute(sizes, 1));
      geometry.instanceCount = dots.length;

      const material = createDotMaterial(h);
      const mesh = new THREE.Mesh(geometry, material);
      scene.add(mesh);
      meshRef.current = mesh;

      // Frame camera
      const dist = Math.max(maxSpread * 1.5, 20);
      camera.position.set(dist * 0.6, dist * 0.5, dist * 0.6);
      camera.lookAt((minX + maxX) / 2, 0, (minZ + maxZ) / 2);

      // OrbitControls (only for edge mode)
      let controls = controlsRef.current;
      if (mode === 'edge' && !controls) {
        controls = new OrbitControls(camera, canvas);
        controls.enableDamping = true;
        controls.target.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
        controls.update();
        controlsRef.current = controls;
      } else if (mode !== 'edge' && controls) {
        controls.dispose();
        controlsRef.current = null;
      }

      // Render
      renderer.render(scene, camera);

      setError(null);
    } catch (e) {
      setError(e.message);
    }

    return () => {
      if (controlsRef.current) {
        controlsRef.current.dispose();
        controlsRef.current = null;
      }
    };
  }, [dots, width, height, mode]);

  // Resize handler
  useEffect(() => {
    const handleResize = () => {
      if (!canvasRef.current || !rendererRef.current) return;
      const w = canvasRef.current.clientWidth;
      const h = canvasRef.current.clientHeight;
      if (w === 0 || h === 0) return;
      rendererRef.current.setSize(w, h);
      if (cameraRef.current) {
        cameraRef.current.aspect = w / h;
        cameraRef.current.updateProjectionMatrix();
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  if (error) {
    return <div style={{ color: '#d97757', fontSize: 11, padding: 8 }}>3D preview error: {error}</div>;
  }

  if (!dots || !dots.length) {
    return <div style={{ color: '#7b827d', fontSize: 11, padding: 8 }}>No dots to preview</div>;
  }

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: 'auto', border: '1px solid #1e262d', borderRadius: 4, background: '#0e1116' }}
    />
  );
}
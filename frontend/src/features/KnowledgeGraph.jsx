import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import "./Features.css";

function useForceLayout(nodes, edges, width, height) {
  const [positions, setPositions] = useState(() => new Map());

  useEffect(() => {
    const next = new Map();
    nodes.forEach((node, index) => {
      const angle = (index / Math.max(nodes.length, 1)) * Math.PI * 2;
      next.set(node.id, {
        x: width / 2 + Math.cos(angle) * Math.min(width, height) * 0.28,
        y: height / 2 + Math.sin(angle) * Math.min(width, height) * 0.28,
        vx: 0,
        vy: 0,
      });
    });
    setPositions(next);
  }, [nodes, width, height]);

  useEffect(() => {
    if (!nodes.length) return undefined;
    let frame = 0;
    const tick = () => {
      setPositions((current) => {
        const copy = new Map(current);
        for (const node of nodes) {
          const pos = copy.get(node.id);
          if (!pos) continue;
          pos.vx += (width / 2 - pos.x) * 0.002;
          pos.vy += (height / 2 - pos.y) * 0.002;
        }
        for (const edge of edges) {
          const a = copy.get(edge.source);
          const b = copy.get(edge.target);
          if (!a || !b) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.max(Math.hypot(dx, dy), 1);
          const force = (dist - 120) * 0.01 * edge.similarity;
          a.vx += (dx / dist) * force;
          a.vy += (dy / dist) * force;
          b.vx -= (dx / dist) * force;
          b.vy -= (dy / dist) * force;
        }
        for (const [idA, a] of copy) {
          for (const [idB, b] of copy) {
            if (idA >= idB) continue;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dist = Math.max(Math.hypot(dx, dy), 40);
            const repulse = 800 / (dist * dist);
            a.vx -= (dx / dist) * repulse;
            a.vy -= (dy / dist) * repulse;
            b.vx += (dx / dist) * repulse;
            b.vy += (dy / dist) * repulse;
          }
        }
        for (const pos of copy.values()) {
          pos.x += pos.vx;
          pos.y += pos.vy;
          pos.vx *= 0.84;
          pos.vy *= 0.84;
          pos.x = Math.min(width - 40, Math.max(40, pos.x));
          pos.y = Math.min(height - 40, Math.max(40, pos.y));
        }
        return new Map(copy);
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [nodes, edges, width, height]);

  return positions;
}

export default function KnowledgeGraphPage() {
  const containerRef = useRef(null);
  const [size, setSize] = useState({ width: 900, height: 520 });
  const [graph, setGraph] = useState({ nodes: [], edges: [], threshold: 0.28 });
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [rebuilding, setRebuilding] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const positions = useForceLayout(graph.nodes, graph.edges, size.width, size.height);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: Math.max(420, entry.contentRect.height) });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  async function loadGraph(search = query) {
    setLoading(true);
    setError("");
    try {
      const data = await api.knowledgeGraph.get({ q: search });
      setGraph(data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load the knowledge graph.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadGraph(""); }, []);

  async function rebuildGraph() {
    setRebuilding(true);
    setError("");
    try {
      await api.knowledgeGraph.rebuild();
      await loadGraph(query);
    } catch (rebuildError) {
      setError(rebuildError instanceof Error ? rebuildError.message : "Graph rebuild failed.");
    } finally {
      setRebuilding(false);
    }
  }

  function onPointerDown(event, nodeId) {
    event.preventDefault();
    const pos = positions.get(nodeId);
    if (!pos) return;
    setDragging(nodeId);
    setOffset({ x: event.clientX / scale - pos.x, y: event.clientY / scale - pos.y });
  }

  function onPointerMove(event) {
    if (!dragging) return;
    positions.set(dragging, {
      ...positions.get(dragging),
      x: event.clientX / scale - offset.x,
      y: event.clientY / scale - offset.y,
      vx: 0,
      vy: 0,
    });
  }

  return (
    <div className="dashboard-page feature-page">
      <div className="dashboard-page-heading">
        <div>
          <span className="dashboard-eyebrow">CONNECTED IDEAS</span>
          <h1>AI Knowledge Graph</h1>
          <p>Explore semantic links between your notes. Drag nodes, zoom, and open any note in one click.</p>
        </div>
        <div className="feature-toolbar">
          <button className="dashboard-secondary-button" type="button" disabled={rebuilding} onClick={rebuildGraph}>
            {rebuilding ? "Analyzing…" : "Rebuild graph"}
          </button>
        </div>
      </div>
      <form
        className="feature-search-row"
        onSubmit={(event) => {
          event.preventDefault();
          loadGraph(query);
        }}
      >
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter nodes by title or content…" />
        <button className="dashboard-primary-button" type="submit">Search</button>
      </form>
      {error && <p className="dashboard-form-error" role="alert">{error}</p>}
      <section className="feature-graph-card" ref={containerRef} onPointerMove={onPointerMove} onPointerUp={() => setDragging(null)} onPointerLeave={() => setDragging(null)}>
        <div className="feature-graph-controls">
          <button type="button" onClick={() => setScale(value => Math.min(2, value + 0.1))}>+</button>
          <button type="button" onClick={() => setScale(value => Math.max(0.5, value - 0.1))}>−</button>
        </div>
        {loading ? <p className="dashboard-search-status" role="status">Loading graph…</p> : (
          <svg className="feature-graph-svg" width={size.width} height={size.height} viewBox={`0 0 ${size.width} ${size.height}`} style={{ transform: `scale(${scale})`, transformOrigin: "center center" }}>
            {graph.edges.map(edge => {
              const a = positions.get(edge.source);
              const b = positions.get(edge.target);
              if (!a || !b) return null;
              return <line key={`${edge.source}-${edge.target}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="rgba(168,85,247,0.35)" strokeWidth={1 + edge.similarity * 3} />;
            })}
            {graph.nodes.map(node => {
              const pos = positions.get(node.id);
              if (!pos) return null;
              return (
                <g key={node.id} transform={`translate(${pos.x}, ${pos.y})`} className="feature-graph-node" onPointerDown={(event) => onPointerDown(event, node.id)}>
                  <circle r="28" />
                  <text y="5">{node.title.slice(0, 1).toUpperCase()}</text>
                  <foreignObject x="-70" y="34" width="140" height="48">
                    <Link to={`/dashboard/notes/${node.id}/edit`} onClick={(event) => event.stopPropagation()}>{node.title || "Untitled"}</Link>
                  </foreignObject>
                </g>
              );
            })}
          </svg>
        )}
        {!loading && !graph.nodes.length && <p className="feature-empty">Create a few notes, then rebuild the graph to discover relationships.</p>}
        {!loading && graph.nodes.length > 0 && (
          <p className="feature-meta">{graph.nodes.length} nodes · {graph.edges.length} links · threshold {graph.threshold.toFixed(2)}</p>
        )}
      </section>
    </div>
  );
}

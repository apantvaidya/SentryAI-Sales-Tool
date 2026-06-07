const svg = document.getElementById("graph");
const viewport = document.getElementById("viewport");
const edgesLayer = document.getElementById("edges");
const nodesLayer = document.getElementById("nodes");
const detailPanel = document.getElementById("detail-panel");
const statsGrid = document.getElementById("stats-grid");
const runMeta = document.getElementById("run-meta");
const runSelect = document.getElementById("run-select");
const reloadButton = document.getElementById("reload-button");
const zoomInButton = document.getElementById("zoom-in");
const zoomOutButton = document.getElementById("zoom-out");
const zoomResetButton = document.getElementById("zoom-reset");

const viewBox = { width: 1600, height: 1100 };
const center = { x: viewBox.width / 2, y: viewBox.height / 2 };

let currentGraph = null;
let currentSelection = null;
let zoom = 1;
let pan = { x: 0, y: 0 };
let dragState = null;

function createSvgElement(name, attrs = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, String(value)));
  return element;
}

function truncate(text, maxLength = 28) {
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function statusClass(status) {
  return status || "accepted";
}

function queryAngle(index, count) {
  const start = -Math.PI / 2;
  return start + (index * Math.PI * 2) / count;
}

function polarPoint(angle, radius) {
  return {
    x: center.x + Math.cos(angle) * radius,
    y: center.y + Math.sin(angle) * radius,
  };
}

function buildLayout(graph) {
  const positioned = new Map();
  const queryNodes = graph.nodes.filter((node) => node.type === "query");
  const personNodes = graph.nodes.filter((node) => node.type === "person");
  const seedNode = graph.nodes.find((node) => node.type === "seed");
  const queryIndex = new Map(queryNodes.map((node, index) => [node.id, index]));
  const personLinks = new Map(personNodes.map((node) => [node.id, []]));

  graph.edges.forEach((edge) => {
    if (edge.type === "query-person" && personLinks.has(edge.target)) {
      personLinks.get(edge.target).push(edge.source);
    }
  });

  positioned.set(seedNode.id, { ...seedNode, x: center.x, y: center.y, r: 54 });

  const queryRadius = 250;
  queryNodes.forEach((queryNode, index) => {
    const point = polarPoint(queryAngle(index, queryNodes.length), queryRadius);
    positioned.set(queryNode.id, { ...queryNode, x: point.x, y: point.y, r: 36 });
  });

  const groupedPeople = new Map(queryNodes.map((queryNode) => [queryNode.id, []]));
  personNodes.forEach((personNode) => {
    const linkedQueries = personLinks.get(personNode.id) || [];
    const primaryQueryId = linkedQueries[0];
    if (primaryQueryId && groupedPeople.has(primaryQueryId)) {
      groupedPeople.get(primaryQueryId).push(personNode);
    }
  });

  queryNodes.forEach((queryNode) => {
    const people = groupedPeople.get(queryNode.id) || [];
    const queryPos = positioned.get(queryNode.id);
    const queryIdx = queryIndex.get(queryNode.id);
    const baseAngle = queryAngle(queryIdx, queryNodes.length);
    const spread = Math.min(Math.PI / 2.8, Math.max(Math.PI / 7, people.length * 0.065));
    const personRadius = 205;
    people.forEach((personNode, personIndex) => {
      const ratio = people.length === 1 ? 0.5 : personIndex / (people.length - 1);
      const angle = baseAngle - spread / 2 + spread * ratio;
      const orbit = polarPoint(angle, queryRadius + personRadius);
      const midPull = 0.18;
      const x = orbit.x * (1 - midPull) + queryPos.x * midPull;
      const y = orbit.y * (1 - midPull) + queryPos.y * midPull;
      positioned.set(personNode.id, {
        ...personNode,
        x,
        y,
        r: 18 + Math.min(10, (personNode.query_count || 1) * 1.6),
      });
    });
  });

  return positioned;
}

function renderStats(graph) {
  const { stats, summary } = graph;
  const storage = summary.storage || {};
  const cards = [
    ["Queries", stats.query_count],
    ["People", stats.person_count],
    ["Nodes", stats.node_count],
    ["Edges", stats.edge_count],
    ["Accepted", summary.accepted_count],
    ["Review", summary.needs_review_count],
    ["Dropped", summary.dropped_count],
    ["Stored", storage.stored_total ?? 0],
  ];
  statsGrid.innerHTML = "";
  cards.forEach(([label, value]) => {
    const card = document.createElement("div");
    card.className = "stat-card";
    card.innerHTML = `<div class="stat-value">${value}</div><div class="stat-label">${label}</div>`;
    statsGrid.appendChild(card);
  });
}

function renderDetails(node) {
  if (!node) {
    detailPanel.innerHTML = `<div class="placeholder">Click a node to inspect it.</div>`;
    return;
  }

  const chips = [];
  if (node.type === "person") {
    chips.push(`<span class="chip ${statusClass(node.status)}">${node.status.replace("_", " ")}</span>`);
    chips.push(
      `<span class="chip ${node.same_company ? "same-company" : "similar-company"}">${
        node.same_company ? "same company" : "similar company"
      }</span>`
    );
  }
  if (node.type === "query") {
    chips.push(`<span class="chip">${node.target_bucket.replace("_", " ")}</span>`);
  }

  const lines = [];
  if (node.subtitle) lines.push(`<div class="detail-line">${node.subtitle}</div>`);
  if (node.role) lines.push(`<div class="detail-line">Role: ${node.role}</div>`);
  if (node.company) lines.push(`<div class="detail-line">Company: ${node.company}</div>`);
  if (node.location) lines.push(`<div class="detail-line">Location: ${node.location}</div>`);
  if (node.years_at_current_role != null) {
    lines.push(`<div class="detail-line">Years at role: ${node.years_at_current_role}</div>`);
  }
  if (node.linkedin_url) {
    lines.push(`<div class="detail-line"><a href="${node.linkedin_url}" target="_blank" rel="noreferrer">LinkedIn</a></div>`);
  }
  if (node.query_titles?.length) {
    lines.push(`<div class="detail-line">Appears in: ${node.query_titles.join(", ")}</div>`);
  }
  if (node.reasons?.length) {
    lines.push(`<div class="detail-line">Flags: ${node.reasons.join(", ")}</div>`);
  }
  if (node.query_text) {
    lines.push(`<div class="detail-line">${node.query_text.replace(/\n/g, "<br />")}</div>`);
  }

  detailPanel.innerHTML = `
    <div class="eyebrow">${node.type}</div>
    <h2 class="detail-title">${node.title || node.label}</h2>
    ${chips.length ? `<div class="detail-chip-row">${chips.join("")}</div>` : ""}
    ${lines.join("")}
  `;
}

function highlightSelection(nodeId) {
  currentSelection = nodeId;
  const activeSet = new Set([nodeId]);
  if (currentGraph) {
    currentGraph.edges.forEach((edge) => {
      if (edge.source === nodeId || edge.target === nodeId) {
        activeSet.add(edge.source);
        activeSet.add(edge.target);
      }
    });
  }

  nodesLayer.querySelectorAll(".node").forEach((nodeEl) => {
    const id = nodeEl.dataset.nodeId;
    nodeEl.classList.toggle("active", id === nodeId);
    nodeEl.classList.toggle("dimmed", nodeId && !activeSet.has(id));
  });
  edgesLayer.querySelectorAll(".edge").forEach((edgeEl) => {
    const source = edgeEl.dataset.source;
    const target = edgeEl.dataset.target;
    const active = nodeId && (source === nodeId || target === nodeId);
    edgeEl.classList.toggle("active", active);
    edgeEl.classList.toggle("dimmed", nodeId && !active);
  });
}

function renderGraph(graph) {
  currentGraph = graph;
  renderStats(graph);
  runMeta.textContent = `${graph.run_id} • ${graph.summary.search_result_count} raw results • ${graph.summary.accepted_count} accepted`;

  const layout = buildLayout(graph);
  edgesLayer.innerHTML = "";
  nodesLayer.innerHTML = "";

  graph.edges.forEach((edge) => {
    const source = layout.get(edge.source);
    const target = layout.get(edge.target);
    if (!source || !target) return;

    const line = createSvgElement("line", {
      x1: source.x,
      y1: source.y,
      x2: target.x,
      y2: target.y,
      class: `edge ${edge.type}`,
      "data-source": edge.source,
      "data-target": edge.target,
    });
    edgesLayer.appendChild(line);
  });

  graph.nodes.forEach((node) => {
    const pos = layout.get(node.id);
    if (!pos) return;

    const group = createSvgElement("g", {
      class: `node ${node.type} ${node.type === "person" ? statusClass(node.status) : ""}`,
      transform: `translate(${pos.x}, ${pos.y})`,
      "data-node-id": node.id,
    });

    const circle = createSvgElement("circle", { r: pos.r });
    group.appendChild(circle);

    const label = createSvgElement("text", { y: node.type === "seed" ? "-4" : "3" });
    label.textContent = node.type === "query" ? node.label : truncate(node.label, node.type === "seed" ? 22 : 20);
    group.appendChild(label);

    if (node.type === "seed") {
      const subtext = createSvgElement("text", { y: "16", class: "subtext" });
      subtext.textContent = truncate(node.company, 22);
      group.appendChild(subtext);
    } else if (node.type === "query") {
      const subtext = createSvgElement("text", { y: "18", class: "subtext" });
      subtext.textContent = node.target_bucket === "same_company" ? "same company" : "similar company";
      group.appendChild(subtext);
    }

    group.addEventListener("click", () => {
      renderDetails(node);
      highlightSelection(node.id);
    });
    group.addEventListener("mouseenter", () => {
      if (!currentSelection) highlightSelection(node.id);
    });
    group.addEventListener("mouseleave", () => {
      if (!currentSelection) highlightSelection(null);
    });

    nodesLayer.appendChild(group);
  });

  renderDetails(graph.nodes.find((node) => node.type === "seed"));
  highlightSelection("seed");
}

function applyViewportTransform() {
  viewport.setAttribute("transform", `translate(${pan.x} ${pan.y}) scale(${zoom})`);
}

function changeZoom(delta) {
  zoom = Math.min(2.2, Math.max(0.45, zoom + delta));
  applyViewportTransform();
}

function resetViewport() {
  zoom = 1;
  pan = { x: 0, y: 0 };
  applyViewportTransform();
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
}

async function loadRuns() {
  const payload = await fetchJson("/api/runs");
  runSelect.innerHTML = "";
  payload.runs.forEach((runId) => {
    const option = document.createElement("option");
    option.value = runId;
    option.textContent = runId;
    if (runId === payload.latest) option.selected = true;
    runSelect.appendChild(option);
  });
}

async function loadGraph(runId = null) {
  const url = runId ? `/api/graph?run_id=${encodeURIComponent(runId)}` : "/api/graph/latest";
  const graph = await fetchJson(url);
  renderGraph(graph);
}

function initPanAndZoom() {
  svg.addEventListener("mousedown", (event) => {
    if (event.target.closest(".node")) return;
    svg.classList.add("dragging");
    dragState = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
  });

  window.addEventListener("mousemove", (event) => {
    if (!dragState) return;
    const dx = event.clientX - dragState.x;
    const dy = event.clientY - dragState.y;
    pan = { x: dragState.panX + dx, y: dragState.panY + dy };
    applyViewportTransform();
  });

  window.addEventListener("mouseup", () => {
    dragState = null;
    svg.classList.remove("dragging");
  });

  svg.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      changeZoom(event.deltaY < 0 ? 0.08 : -0.08);
    },
    { passive: false }
  );
}

reloadButton.addEventListener("click", async () => {
  await loadRuns();
  await loadGraph(runSelect.value);
});

runSelect.addEventListener("change", async () => {
  await loadGraph(runSelect.value);
});

zoomInButton.addEventListener("click", () => changeZoom(0.12));
zoomOutButton.addEventListener("click", () => changeZoom(-0.12));
zoomResetButton.addEventListener("click", resetViewport);

async function main() {
  initPanAndZoom();
  applyViewportTransform();
  await loadRuns();
  await loadGraph(runSelect.value);
}

main().catch((error) => {
  runMeta.textContent = `Failed to load graph: ${error.message}`;
  detailPanel.innerHTML = `<div class="placeholder">${error.message}</div>`;
});

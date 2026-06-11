const svg = document.getElementById("graph");
const viewport = document.getElementById("viewport");
const edgesLayer = document.getElementById("edges");
const nodesLayer = document.getElementById("nodes");
const detailPanel = document.getElementById("detail-panel");
const statsGrid = document.getElementById("stats-grid");
const runMeta = document.getElementById("run-meta");
const runSelect = document.getElementById("run-select");
const viewSelect = document.getElementById("view-select");
const reloadButton = document.getElementById("reload-button");
const zoomInButton = document.getElementById("zoom-in");
const zoomOutButton = document.getElementById("zoom-out");
const zoomResetButton = document.getElementById("zoom-reset");
const graphZoomControls = document.getElementById("graph-zoom-controls");
const graphLegend = document.getElementById("graph-legend");
const runColorLegend = document.getElementById("run-color-legend");
const runColorList = document.getElementById("run-color-list");
const overlapLegend = document.getElementById("overlap-legend");
const overlapControls = document.getElementById("overlap-controls");
const overlapFocusSelect = document.getElementById("overlap-focus-select");
const overlapView = document.getElementById("overlap-view");
const overlapStage = document.getElementById("overlap-stage");
const pairwiseList = document.getElementById("pairwise-list");
const databaseList = document.getElementById("database-list");

const viewBox = { width: 1600, height: 1100 };
const center = { x: viewBox.width / 2, y: viewBox.height / 2 };
const DENSE_GRAPH_THRESHOLD = 1500;

let currentGraph = null;
let currentOverlap = null;
let currentOverlapFocus = null;
let currentSelection = null;
let currentEdgeSelection = null;
let currentOverlapDetail = null;
let autoSelectGraphNode = false;
let autoSelectOverlapDetail = false;
let zoom = 1;
let pan = { x: 0, y: 0 };
let dragState = null;
let nodeDragState = null;
let nodePositionOverrides = new Map();
let draggedNodeId = null;
let overlapNodeDragState = null;
let overlapDraggedNodeId = null;
let overlapPositionOverrides = new Map();
let graphRenderFrame = null;
const queryResultsCache = new Map();
const queryOverlapCache = new Map();

function createSvgElement(name, attrs = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, String(value)));
  return element;
}

function truncate(text, maxLength = 28) {
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function escapeHtml(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function statusClass(status) {
  return status || "accepted";
}

function activeView() {
  return viewSelect.value;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function pairMatchesFocus(pair, focusVectorId) {
  return pair.left_vector_id === focusVectorId || pair.right_vector_id === focusVectorId;
}

function otherVectorId(pair, focusVectorId) {
  return pair.left_vector_id === focusVectorId ? pair.right_vector_id : pair.left_vector_id;
}

function otherLabel(pair, focusVectorId) {
  return pair.left_vector_id === focusVectorId ? pair.right_label : pair.left_label;
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

function polarPointAround(originX, originY, angle, radius) {
  return {
    x: originX + Math.cos(angle) * radius,
    y: originY + Math.sin(angle) * radius,
  };
}

function edgeEndpoints(source, target, padding = 4) {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const distance = Math.hypot(dx, dy) || 1;
  const ux = dx / distance;
  const uy = dy / distance;
  const startOffset = Math.min(source.r + padding, Math.max(0, distance / 2 - 2));
  const endOffset = Math.min(target.r + padding, Math.max(0, distance / 2 - 2));
  return {
    x1: source.x + ux * startOffset,
    y1: source.y + uy * startOffset,
    x2: target.x - ux * endOffset,
    y2: target.y - uy * endOffset,
  };
}

function absoluteCircleEndpoints(source, target, sourceRadius, targetRadius, padding = 4) {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const distance = Math.hypot(dx, dy) || 1;
  const ux = dx / distance;
  const uy = dy / distance;
  const startOffset = Math.min(sourceRadius + padding, Math.max(0, distance / 2 - 2));
  const endOffset = Math.min(targetRadius + padding, Math.max(0, distance / 2 - 2));
  return {
    x1: source.x + ux * startOffset,
    y1: source.y + uy * startOffset,
    x2: target.x - ux * endOffset,
    y2: target.y - uy * endOffset,
  };
}

function buildLayout(graph) {
  if (graph.mode === "aggregate") {
    return buildAggregateLayout(graph);
  }
  if (graph.mode === "seed_searches") {
    return buildSeedSearchesLayout(graph);
  }
  return buildSingleRunLayout(graph);
}

function buildSingleRunLayout(graph) {
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

  const seedOverride = nodePositionOverrides.get(seedNode.id);
  const seedPosition = seedOverride || { x: center.x, y: center.y };
  positioned.set(seedNode.id, { ...seedNode, x: seedPosition.x, y: seedPosition.y, r: 54 });

  const queryRadius = 250;
  queryNodes.forEach((queryNode, index) => {
    const override = nodePositionOverrides.get(queryNode.id);
    const point = override || polarPointAround(seedPosition.x, seedPosition.y, queryAngle(index, queryNodes.length), queryRadius);
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
      const orbit = polarPointAround(seedPosition.x, seedPosition.y, angle, queryRadius + personRadius);
      const midPull = 0.18;
      const x = orbit.x * (1 - midPull) + queryPos.x * midPull;
      const y = orbit.y * (1 - midPull) + queryPos.y * midPull;
      const override = nodePositionOverrides.get(personNode.id);
      positioned.set(personNode.id, {
        ...personNode,
        x: override?.x ?? x,
        y: override?.y ?? y,
        r: 18 + Math.min(10, (personNode.query_count || 1) * 1.6),
      });
    });
  });

  return positioned;
}

function buildAggregateLayout(graph) {
  const positioned = new Map();
  const seedNodes = graph.nodes.filter((node) => node.type === "seed");
  const queryNodes = graph.nodes.filter((node) => node.type === "query");
  const personNodes = graph.nodes.filter((node) => node.type === "person");
  const queryNodeMap = new Map(queryNodes.map((node) => [node.id, node]));
  const seedQueries = new Map(seedNodes.map((node) => [node.id, []]));
  const personLinks = new Map(personNodes.map((node) => [node.id, []]));

  graph.edges.forEach((edge) => {
    if (edge.type === "seed-query" && seedQueries.has(edge.source)) {
      seedQueries.get(edge.source).push(edge.target);
    }
    if (edge.type === "query-person" && personLinks.has(edge.target)) {
      personLinks.get(edge.target).push(edge.source);
    }
  });

  const columns = Math.max(1, Math.ceil(Math.sqrt(seedNodes.length * 1.45)));
  const rows = Math.max(1, Math.ceil(seedNodes.length / columns));
  const horizontalSpacing = Math.min(520, 1320 / Math.max(1, columns - 1));
  const verticalSpacing = Math.min(420, 820 / Math.max(1, rows - 1));
  const clusterScale = clamp(Math.min(horizontalSpacing / 520, verticalSpacing / 420), 0.18, 1);
  const gridWidth = horizontalSpacing * Math.max(0, columns - 1);
  const gridHeight = verticalSpacing * Math.max(0, rows - 1);
  const gridOriginX = center.x - gridWidth / 2;
  const gridOriginY = center.y - gridHeight / 2;

  seedNodes.forEach((seedNode, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const seedOverride = nodePositionOverrides.get(seedNode.id);
    const seedX = seedOverride?.x ?? (gridOriginX + col * horizontalSpacing);
    const seedY = seedOverride?.y ?? (gridOriginY + row * verticalSpacing);
    positioned.set(seedNode.id, { ...seedNode, x: seedX, y: seedY, r: Math.max(10, 46 * clusterScale) });

    const attachedQueries = (seedQueries.get(seedNode.id) || [])
      .map((queryId) => queryNodeMap.get(queryId))
      .filter(Boolean);
    const queryRadius = Math.max(22, 178 * clusterScale);
    attachedQueries.forEach((queryNode, queryIndex) => {
      const override = nodePositionOverrides.get(queryNode.id);
      const point =
        override ||
        {
          x: seedX + Math.cos(queryAngle(queryIndex, attachedQueries.length)) * queryRadius,
          y: seedY + Math.sin(queryAngle(queryIndex, attachedQueries.length)) * queryRadius,
        };
      positioned.set(queryNode.id, { ...queryNode, x: point.x, y: point.y, r: Math.max(6, 32 * clusterScale) });
    });
  });

  personNodes.forEach((personNode, index) => {
    const linkedQueries = personLinks.get(personNode.id) || [];
    const linkedPositions = linkedQueries.map((queryId) => positioned.get(queryId)).filter(Boolean);
    if (!linkedPositions.length) return;
    const avgX = linkedPositions.reduce((sum, pos) => sum + pos.x, 0) / linkedPositions.length;
    const avgY = linkedPositions.reduce((sum, pos) => sum + pos.y, 0) / linkedPositions.length;
    const multiRunLift = (personNode.run_count || 1) > 1 ? -28 : 0;
    const jitterAngle = ((index % 11) / 11) * Math.PI * 2;
    const jitterRadius = (linkedQueries.length > 1 ? 20 : 72) * clusterScale;
    const override = nodePositionOverrides.get(personNode.id);
    positioned.set(personNode.id, {
      ...personNode,
      x: override?.x ?? (avgX + Math.cos(jitterAngle) * jitterRadius),
      y: override?.y ?? (avgY + Math.sin(jitterAngle) * jitterRadius + multiRunLift),
      r: Math.max(5, (18 + Math.min(12, (personNode.query_count || 1) * 1.4 + (personNode.run_count || 1) * 1.6)) * clusterScale),
    });
  });

  return positioned;
}

function buildSeedSearchesLayout(graph) {
  const positioned = new Map();
  const seedNodes = graph.nodes.filter((node) => node.type === "seed");
  const columns = Math.max(1, Math.ceil(Math.sqrt(seedNodes.length * 1.45)));
  const rows = Math.max(1, Math.ceil(seedNodes.length / columns));
  const horizontalSpacing = Math.min(520, 1320 / Math.max(1, columns - 1));
  const verticalSpacing = Math.min(420, 820 / Math.max(1, rows - 1));
  const gridWidth = horizontalSpacing * Math.max(0, columns - 1);
  const gridHeight = verticalSpacing * Math.max(0, rows - 1);
  const gridOriginX = center.x - gridWidth / 2;
  const gridOriginY = center.y - gridHeight / 2;

  seedNodes.forEach((seedNode, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const seedOverride = nodePositionOverrides.get(seedNode.id);
    const seedX = seedOverride?.x ?? (gridOriginX + col * horizontalSpacing);
    const seedY = seedOverride?.y ?? (gridOriginY + row * verticalSpacing);
    positioned.set(seedNode.id, { ...seedNode, x: seedX, y: seedY, r: 44 });
  });

  return positioned;
}

function renderRunColorLegend(graph) {
  const isAggregateLike = graph.mode === "aggregate" || graph.mode === "seed_searches";
  runColorLegend.classList.toggle("hidden", !isAggregateLike);
  if (!isAggregateLike) {
    runColorList.innerHTML = "";
    return;
  }

  const eyebrow = runColorLegend.querySelector(".eyebrow");
  if (eyebrow) {
    eyebrow.textContent = graph.mode === "seed_searches" ? "Search Colors" : "Search Colors · Seed / Queries";
  }

  const runs = graph.summary.runs || [];
  const visibleRuns = runs.slice(0, 40);
  runColorList.innerHTML = visibleRuns
    .map(
      (run) => `
        <div class="run-color-row">
          ${
            graph.mode === "seed_searches"
              ? `<span class="swatch" style="background:${run.run_color};color:${run.run_color}" title="Search color"></span>`
              : `
                <span class="run-color-pair" title="Seed color / query color">
                  <span class="swatch" style="background:${run.run_color};color:${run.run_color}"></span>
                  <span class="swatch query-color" style="background:${run.query_color};color:${run.query_color}"></span>
                </span>
              `
          }
          <span title="${escapeHtml(run.run_id)}">${escapeHtml(truncate(run.run_label, 34))}</span>
        </div>
      `
    )
    .join("");
  if (runs.length > visibleRuns.length) {
    runColorList.insertAdjacentHTML(
      "beforeend",
      `<div class="run-color-more">+${runs.length - visibleRuns.length} more searches</div>`
    );
  }
}

function hydrateAggregateRunMetadata(graph) {
  if ((graph.mode !== "aggregate" && graph.mode !== "seed_searches") || graph.run_metadata_hydrated) return;
  const runMetadata = new Map((graph.summary.runs || []).map((run) => [run.run_index, run]));
  graph.nodes.forEach((node) => {
    const run = runMetadata.get(node.run_index);
    if (!run) return;
    node.run_label = run.run_label;
    node.run_color = node.type === "query" ? run.query_color : run.run_color;
  });
  graph.edges.forEach((edge) => {
    const run = runMetadata.get(edge.run_index);
    if (run) edge.run_color = edge.type === "seed-query" ? run.query_color : run.run_color;
  });
  graph.run_metadata_hydrated = true;
}

function renderStats(graph) {
  const { stats, summary } = graph;
  const storage = summary.storage || {};
  const cards = graph.mode === "aggregate"
    ? [
        ["Runs", summary.run_count],
        ["Seeds", stats.seed_count],
        ["Queries", stats.query_count],
        ["Visible people", stats.person_count],
        ["All people", stats.unique_people_count ?? stats.person_count],
        ["Shared", summary.cross_run_people_count],
        ["Recursive", summary.recursive_seed_link_count],
        ["Query overlaps", stats.positive_query_overlap_count ?? stats.query_overlap_edge_count ?? 0],
      ]
    : graph.mode === "seed_searches"
      ? [
          ["Searches", summary.run_count],
          ["Seeds", stats.seed_count],
          ["Later seeds", summary.derived_seed_count],
          ["Roots", summary.root_seed_count],
          ["Lineage links", summary.seed_lineage_edge_count],
          ["Producing queries", stats.producing_query_link_count],
        ]
      : [
          ["Queries", stats.query_count],
          ["People", stats.person_count],
          ["Nodes", stats.node_count],
          ["Edges", stats.edge_count],
          ["Accepted", summary.accepted_count],
          ["Flagged", summary.accepted_with_flags_count ?? 0],
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

function renderOverlapStats(overlap) {
  const cards = [
    ["Queries", overlap.stats.query_count],
    ["DB Records", overlap.stats.database_record_count],
    ["Multi-query", overlap.stats.multi_query_people_count],
    ["Strongest Pair", overlap.stats.strongest_pair_overlap],
    ["Accepted", overlap.summary.accepted_count],
    ["Flagged", overlap.summary.accepted_with_flags_count ?? 0],
    ["Dropped", overlap.summary.dropped_count],
    ["Stored", overlap.summary.storage?.stored_total ?? 0],
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
    if (node.seed_run_ids?.length) {
      chips.push(`<span class="chip lineage">later seed</span>`);
    }
  }
  if (node.type === "query") {
    chips.push(`<span class="chip">${node.target_bucket.replace("_", " ")}</span>`);
  }
  if (node.type === "seed" && node.derived_from_search) {
    chips.push(`<span class="chip lineage">from earlier search</span>`);
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
  if (node.run_ids?.length) {
    lines.push(`<div class="detail-line">Appears across runs: ${node.run_ids.join(", ")}</div>`);
  }
  if (node.seed_run_ids?.length) {
    lines.push(`<div class="detail-line">Used later as a seed in: ${node.seed_run_ids.join(", ")}</div>`);
  }
  if (node.derived_from_query_titles?.length) {
    lines.push(`<div class="detail-line">This seed was previously discovered in: ${node.derived_from_query_titles.join(", ")}</div>`);
  }
  if (node.lineage_source_labels?.length) {
    lines.push(`<div class="detail-line">Earlier searches that found this seed: ${node.lineage_source_labels.join(", ")}</div>`);
  }
  if (node.produced_seed_titles?.length) {
    lines.push(`<div class="detail-line">Later seeds produced from this search: ${node.produced_seed_titles.join(", ")}</div>`);
  }
  if (node.run_id && node.type !== "person") {
    lines.push(`<div class="detail-line">Run: ${node.run_id}</div>`);
  }
  if (node.produced_people_count != null) {
    lines.push(
      `<div class="detail-line">Results: ${node.produced_people_count} total, ${node.visible_person_count} shown in graph, ${node.hidden_person_count} kept inside this query.</div>`
    );
    lines.push(`<div class="detail-line query-people-block" id="query-results-detail"><strong>People from this query</strong><div class="placeholder">Loading results…</div></div>`);
  }
  if (node.reasons?.length) {
    lines.push(`<div class="detail-line">Auto-approved flags: ${node.reasons.join(", ")}</div>`);
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

async function loadAggregateQueryDetails(node) {
  const detailTarget = document.getElementById("query-results-detail");
  if (!detailTarget || !node.run_id || !node.vector_id) return;

  try {
    const cacheKey = `${node.run_id}::${node.vector_id}`;
    let payload = queryResultsCache.get(cacheKey);
    if (!payload) {
      payload = await fetchJson(
        `/api/query-results?run_id=${encodeURIComponent(node.run_id)}&vector_id=${encodeURIComponent(node.vector_id)}`
      );
      queryResultsCache.set(cacheKey, payload);
    }
    if (currentSelection !== node.id) return;
    const renderedPeople = payload.people
      .map((person) => {
        const meta = [person.current_title, person.current_company, person.status].filter(Boolean).join(" • ");
        const label = escapeHtml(person.full_name || "Unknown Person");
        const metaHtml = meta ? `<span class="query-person-meta">${escapeHtml(meta)}</span>` : "";
        const linkHtml = person.linkedin_url
          ? ` <a href="${person.linkedin_url}" target="_blank" rel="noreferrer">LinkedIn</a>`
          : "";
        return `<li><span class="query-person-name">${label}</span>${metaHtml}${linkHtml}</li>`;
      })
      .join("");
    detailTarget.innerHTML = `<strong>People from this query (${payload.person_count})</strong><ul class="query-people-list">${renderedPeople}</ul>`;
  } catch (error) {
    detailTarget.innerHTML = `<strong>People from this query</strong><div class="placeholder">${escapeHtml(error.message)}</div>`;
  }
}

function clearInspector() {
  currentSelection = null;
  currentEdgeSelection = null;
  renderDetails(null);
}

function renderQueryOverlapDetails(edge) {
  detailPanel.innerHTML = `
    <div class="eyebrow">query overlap</div>
    <h2 class="detail-title">${edge.intersection_count} shared ${edge.intersection_count === 1 ? "person" : "people"}</h2>
    <div class="detail-line">Loading shared people…</div>
  `;
}

async function loadQueryOverlapDetails(edge) {
  const params = new URLSearchParams({
    left_query_id: edge.source,
    right_query_id: edge.target,
  });
  try {
    let payload = queryOverlapCache.get(edge.id);
    if (!payload) {
      payload = await fetchJson(`/api/query-overlap?${params}`);
      queryOverlapCache.set(edge.id, payload);
    }
    if (currentEdgeSelection !== edge.id) return;
    const people = payload.shared_people
      .map((person) => {
        const meta = [person.current_title, person.current_company].filter(Boolean).join(" • ");
        const linkHtml = person.linkedin_url
          ? ` <a href="${person.linkedin_url}" target="_blank" rel="noreferrer">LinkedIn</a>`
          : "";
        return `<li><span class="query-person-name">${escapeHtml(person.full_name)}</span>${
          meta ? `<span class="query-person-meta">${escapeHtml(meta)}</span>` : ""
        }${linkHtml}</li>`;
      })
      .join("");
    detailPanel.innerHTML = `
      <div class="eyebrow">query overlap</div>
      <h2 class="detail-title">${payload.intersection_count} shared ${payload.intersection_count === 1 ? "person" : "people"}</h2>
      <div class="detail-chip-row">
        <span class="chip">${escapeHtml(payload.left.label)}</span>
        <span class="chip">${escapeHtml(payload.right.label)}</span>
      </div>
      <div class="detail-line">${escapeHtml(payload.left.run_label)}</div>
      <div class="detail-line">${escapeHtml(payload.right.run_label)}</div>
      <div class="detail-line query-people-block"><strong>Shared people</strong><ul class="query-people-list">${people}</ul></div>
    `;
  } catch (error) {
    detailPanel.innerHTML = `<div class="placeholder">${escapeHtml(error.message)}</div>`;
  }
}

function renderLineageDetails(edge) {
  const sourceNode = currentGraph?.nodes.find((node) => node.id === edge.source);
  const targetNode = currentGraph?.nodes.find((node) => node.id === edge.target);
  const producingQueries = edge.producing_queries?.length
    ? edge.producing_queries
    : sourceNode?.type === "query"
      ? [
          {
            title: sourceNode.title || sourceNode.label,
            query_text: sourceNode.query_text,
            target_bucket: sourceNode.target_bucket,
          },
        ]
      : [];

  const queryItems = producingQueries.length
    ? producingQueries
        .map((query) => {
          const meta = [query.target_bucket?.replace("_", " "), query.query_id].filter(Boolean).join(" • ");
          const metaHtml = meta ? `<span class="query-person-meta">${escapeHtml(meta)}</span>` : "";
          const textHtml = query.query_text
            ? `<span class="query-person-meta">${escapeHtml(query.query_text).replace(/\n/g, "<br />")}</span>`
            : "";
          return `<li><span class="query-person-name">${escapeHtml(query.title || "Producing query")}</span>${metaHtml}${textHtml}</li>`;
        })
        .join("")
    : `<li><span class="query-person-name">No producing query details available.</span></li>`;

  detailPanel.innerHTML = `
    <div class="eyebrow">seed lineage</div>
    <h2 class="detail-title">${escapeHtml(targetNode?.title || targetNode?.label || edge.target_run_label || "Later seed")}</h2>
    <div class="detail-chip-row">
      <span class="chip lineage">later seed</span>
      <span class="chip">${producingQueries.length} producing ${producingQueries.length === 1 ? "query" : "queries"}</span>
    </div>
    <div class="detail-line">From search: ${escapeHtml(edge.source_run_label || sourceNode?.run_label || sourceNode?.title || sourceNode?.label || edge.source_run_id || "")}</div>
    <div class="detail-line">To seed: ${escapeHtml(edge.target_run_label || targetNode?.run_label || targetNode?.title || targetNode?.label || edge.target_run_id || "")}</div>
    <div class="detail-line query-people-block"><strong>Producing queries</strong><ul class="query-people-list">${queryItems}</ul></div>
  `;
}

function renderOverlapDetails(focusQuery, overlap) {
  const topPairs = overlap.pairwise
    .filter((item) => pairMatchesFocus(item, focusQuery.vector_id))
    .sort((a, b) => b.intersection_count - a.intersection_count)
    .slice(0, 4);
  const dbMatch = overlap.database_overlaps.find((item) => item.vector_id === focusQuery.vector_id);

  detailPanel.innerHTML = `
    <div class="eyebrow">overlap</div>
    <h2 class="detail-title">${focusQuery.label}</h2>
    <div class="detail-chip-row">
      <span class="chip">${focusQuery.target_bucket.replace("_", " ")}</span>
      <span class="chip">results ${focusQuery.result_count}</span>
      <span class="chip">db overlap ${focusQuery.database_overlap_count}</span>
    </div>
    <div class="detail-line">${focusQuery.query_text.replace(/\n/g, "<br />")}</div>
    <div class="detail-line">Same-company results: ${focusQuery.same_company_count}</div>
    <div class="detail-line">Similar-company results: ${focusQuery.similar_company_count}</div>
    <div class="detail-line">Current leads database overlap: ${dbMatch?.intersection_count ?? 0}</div>
    <div class="detail-line">Top pair overlaps: ${
      topPairs.length
        ? topPairs
            .map((item) => {
              const other = otherLabel(item, focusQuery.vector_id);
              return `${other} (${item.intersection_count})`;
            })
            .join(", ")
        : "None"
    }</div>
    <div class="detail-line">${overlap.database_info.note}</div>
  `;
}

function renderDatabaseDetails(dbNode, overlap) {
  detailPanel.innerHTML = `
    <div class="eyebrow">database</div>
    <h2 class="detail-title">Pre-run Database</h2>
    <div class="detail-chip-row">
      <span class="chip">records ${overlap.database_info.record_count}</span>
    </div>
    <div class="detail-line">${overlap.database_info.note}</div>
    <div class="detail-line">Shared with current focus query: ${dbNode?.intersection_count ?? 0}</div>
  `;
}

function highlightSelection(nodeId) {
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

function highlightEdgeSelection(edge) {
  nodesLayer.querySelectorAll(".node").forEach((nodeEl) => {
    const id = nodeEl.dataset.nodeId;
    nodeEl.classList.toggle("active", id === edge.source || id === edge.target);
    nodeEl.classList.toggle("dimmed", id !== edge.source && id !== edge.target);
  });
  edgesLayer.querySelectorAll(".edge").forEach((edgeEl) => {
    const selected = edgeEl.dataset.edgeId === edge.id;
    edgeEl.classList.toggle("active", selected);
    edgeEl.classList.toggle("dimmed", !selected);
  });
}

function renderGraph(graph) {
  currentGraph = graph;
  hydrateAggregateRunMetadata(graph);
  renderStats(graph);
  renderRunColorLegend(graph);
  const denseGraph = graph.mode === "aggregate" && graph.nodes.length > DENSE_GRAPH_THRESHOLD;
  svg.classList.toggle("dense-graph", denseGraph);
  runMeta.textContent = graph.mode === "aggregate"
    ? `${graph.summary.run_count} searches • ${graph.stats.unique_people_count ?? graph.stats.person_count} people discovered • ${graph.summary.cross_run_people_count} shared across runs`
    : graph.mode === "seed_searches"
      ? `${graph.summary.run_count} searches • ${graph.summary.seed_lineage_edge_count} lineage links • ${graph.summary.recursive_seed_link_count} producing queries mapped`
      : `${graph.run_id} • ${graph.summary.search_result_count} raw results • ${graph.summary.accepted_count} accepted`;

  const layout = buildLayout(graph);
  edgesLayer.innerHTML = "";
  nodesLayer.innerHTML = "";

  graph.edges.forEach((edge) => {
    if (edge.type === "query-person") {
      if (denseGraph && currentSelection !== edge.source && currentSelection !== edge.target) return;
    }
    if (edge.type === "query-overlap" && (edge.intersection_count || 0) < 5) return;
    const source = layout.get(edge.source);
    const target = layout.get(edge.target);
    if (!source || !target) return;
    const points = edgeEndpoints(source, target, edge.type === "query-seed-origin" ? 1 : 4);

    const line = createSvgElement("line", {
      x1: points.x1,
      y1: points.y1,
      x2: points.x2,
      y2: points.y2,
      class: `edge ${edge.type}`,
      "data-source": edge.source,
      "data-target": edge.target,
      "data-edge-id": edge.id,
      style: edge.run_color ? `stroke:${edge.run_color}` : "",
      "stroke-opacity": edge.run_color ? (edge.type === "seed-lineage" ? "0.82" : "0.48") : "",
      "stroke-width": edge.type === "query-overlap"
        ? clamp(1.4 + Math.log2((edge.intersection_count || 1) + 1), 1.4, 7)
        : "",
      "marker-end": edge.type === "query-seed-origin" || edge.type === "seed-lineage" ? "url(#lineageArrow)" : "",
    });
    if (edge.type === "query-overlap") {
      line.addEventListener("click", (event) => {
        event.stopPropagation();
        currentSelection = null;
        currentEdgeSelection = edge.id;
        renderQueryOverlapDetails(edge);
        highlightEdgeSelection(edge);
        loadQueryOverlapDetails(edge);
      });
    } else if (edge.type === "query-seed-origin" || edge.type === "seed-lineage") {
      line.addEventListener("click", (event) => {
        event.stopPropagation();
        currentSelection = null;
        currentEdgeSelection = edge.id;
        renderLineageDetails(edge);
        highlightEdgeSelection(edge);
      });
    }
    edgesLayer.appendChild(line);
  });

  graph.nodes.forEach((node) => {
    const pos = layout.get(node.id);
    if (!pos) return;

    const group = createSvgElement("g", {
      class: `node ${node.type} ${node.type === "person" ? statusClass(node.status) : ""} ${
        node.type === "person" && node.seed_run_ids?.length ? "seed-linked" : ""
      } ${node.type === "seed" && node.derived_from_search ? "derived" : ""} ${
        node.run_color ? "run-colored" : ""
      }`,
      transform: `translate(${pos.x}, ${pos.y})`,
      "data-node-id": node.id,
      style: node.run_color ? `--run-color:${node.run_color}` : "",
    });

    if (node.type === "person" && node.seed_run_ids?.length) {
      group.appendChild(createSvgElement("circle", { r: pos.r + 6, class: "lineage-ring" }));
    }
    if (node.type === "seed" && node.derived_from_search) {
      group.appendChild(createSvgElement("circle", { r: pos.r + 8, class: "lineage-ring" }));
    }

    const circle = createSvgElement("circle", { r: pos.r });
    group.appendChild(circle);

    if (node.type === "person" && node.seed_run_ids?.length) {
      group.appendChild(createSvgElement("circle", { cx: pos.r - 5, cy: -pos.r + 5, r: 10, class: "lineage-badge" }));
      const badgeText = createSvgElement("text", { x: pos.r - 5, y: -pos.r + 8, class: "lineage-badge-text" });
      badgeText.textContent = "S";
      group.appendChild(badgeText);
    }

    const showLabel =
      !denseGraph ||
      node.id === currentSelection ||
      (node.type === "seed" && graph.stats.seed_count <= 200);
    if (showLabel) {
      const label = createSvgElement("text", { y: node.type === "seed" ? "-4" : "3" });
      label.textContent = node.type === "query"
        ? truncate(node.label, 18)
        : truncate(node.label, node.type === "seed" ? 22 : 20);
      group.appendChild(label);
    }

    if (node.type === "seed") {
      const subtext = createSvgElement("text", { y: "16", class: "subtext" });
      subtext.textContent = graph.mode === "aggregate" || graph.mode === "seed_searches"
        ? truncate(node.run_label, 28)
        : truncate(node.company, 22);
      group.appendChild(subtext);
      if (node.derived_from_search) {
        const lineageNote = createSvgElement("text", { y: "30", class: "seed-lineage-note" });
        lineageNote.textContent = "from prior search";
        group.appendChild(lineageNote);
      }
    } else if (node.type === "query" && showLabel) {
      const subtext = createSvgElement("text", { y: "18", class: "subtext" });
      subtext.textContent = graph.mode === "aggregate"
        ? truncate(node.run_label, 24)
        : node.target_bucket === "same_company" ? "same company" : "similar company";
      group.appendChild(subtext);
    }

    group.addEventListener("click", () => {
      if (draggedNodeId === node.id) {
        draggedNodeId = null;
        return;
      }
      currentSelection = node.id;
      currentEdgeSelection = null;
      renderDetails(node);
      highlightSelection(node.id);
      if (graph.mode === "aggregate" && node.type === "query") {
        loadAggregateQueryDetails(node);
      }
      if (denseGraph) {
        scheduleGraphRender();
      }
    });
    if (!denseGraph) {
      group.addEventListener("mouseenter", () => {
        if (!currentSelection) highlightSelection(node.id);
      });
      group.addEventListener("mouseleave", () => {
        if (!currentSelection) highlightSelection(null);
      });
    }
    group.addEventListener("mousedown", (event) => {
      event.stopPropagation();
      nodeDragState = {
        nodeId: node.id,
        startX: event.clientX,
        startY: event.clientY,
        startPos: { x: pos.x, y: pos.y },
        moved: false,
      };
    });

    nodesLayer.appendChild(group);
  });

  const selectedNode = currentSelection ? graph.nodes.find((node) => node.id === currentSelection) : null;
  const selectedEdge = currentEdgeSelection
    ? graph.edges.find((edge) => edge.id === currentEdgeSelection)
    : null;
  if (selectedEdge) {
    if (selectedEdge.type === "query-overlap") {
      renderQueryOverlapDetails(selectedEdge);
      highlightEdgeSelection(selectedEdge);
      loadQueryOverlapDetails(selectedEdge);
    } else if (selectedEdge.type === "query-seed-origin" || selectedEdge.type === "seed-lineage") {
      renderLineageDetails(selectedEdge);
      highlightEdgeSelection(selectedEdge);
    }
  } else if (selectedNode) {
    renderDetails(selectedNode);
    highlightSelection(selectedNode.id);
    if (graph.mode === "aggregate" && selectedNode.type === "query") {
      loadAggregateQueryDetails(selectedNode);
    }
  } else if (autoSelectGraphNode) {
    const defaultNode = graph.nodes.find((node) => node.type === "seed");
    if (defaultNode) {
      currentSelection = defaultNode.id;
      renderDetails(defaultNode);
      highlightSelection(defaultNode.id);
    } else {
      clearInspector();
      highlightSelection(null);
    }
  } else {
    renderDetails(null);
    highlightSelection(null);
  }
  autoSelectGraphNode = false;
}

function scheduleGraphRender() {
  if (graphRenderFrame || !currentGraph) return;
  graphRenderFrame = requestAnimationFrame(() => {
    graphRenderFrame = null;
    renderGraph(currentGraph);
  });
}

function populateOverlapFocus(overlap) {
  overlapFocusSelect.innerHTML = "";
  overlap.queries.forEach((query) => {
    const option = document.createElement("option");
    option.value = query.vector_id;
    option.textContent = `${query.short_label} • ${query.result_count} results`;
    overlapFocusSelect.appendChild(option);
  });
}

function renderPairwiseCards(overlap, focusVectorId) {
  const items = overlap.pairwise
    .filter((item) => pairMatchesFocus(item, focusVectorId))
    .sort((a, b) => b.intersection_count - a.intersection_count || b.jaccard - a.jaccard);
  pairwiseList.innerHTML = "";
  const visibleItems = items.filter((item) => item.intersection_count > 0);
  visibleItems.forEach((item) => {
    const label = otherLabel(item, focusVectorId);
    const card = document.createElement("div");
    card.className = "overlap-card";
    card.innerHTML = `
      <div class="overlap-card-header">
        <div class="overlap-card-title">${label}</div>
        <div class="overlap-card-metric">${item.intersection_count}</div>
      </div>
      <div class="overlap-card-meta">
        Jaccard similarity: ${item.jaccard}<br />
        Focus-only: ${item.left_vector_id === focusVectorId ? item.left_only_count : item.right_only_count}<br />
        Other-only: ${item.left_vector_id === focusVectorId ? item.right_only_count : item.left_only_count}
      </div>
    `;
    pairwiseList.appendChild(card);
  });
  const hiddenZeroOverlap = items.length - visibleItems.length;
  if (hiddenZeroOverlap > 0) {
    const note = document.createElement("div");
    note.className = "overlap-card overlap-card-muted";
    note.innerHTML = `<div class="overlap-card-meta">${hiddenZeroOverlap} zero-overlap queries are hidden from this list.</div>`;
    pairwiseList.appendChild(note);
  }
}

function renderDatabaseCards(overlap) {
  databaseList.innerHTML = "";
  overlap.database_overlaps
    .slice()
    .sort((a, b) => b.intersection_count - a.intersection_count)
    .forEach((item) => {
    const card = document.createElement("div");
    card.className = "overlap-card";
    card.innerHTML = `
      <div class="overlap-card-header">
        <div class="overlap-card-title">${item.label}</div>
        <div class="overlap-card-metric">${item.intersection_count}</div>
      </div>
      <div class="overlap-card-meta">
        Query-only: ${item.query_only_count}<br />
        Database size outside query: ${item.database_only_count}
      </div>
    `;
    databaseList.appendChild(card);
  });
}

function createText(x, y, className, text) {
  const el = createSvgElement("text", { x, y, class: className });
  el.textContent = text;
  return el;
}

function edgeStrokeWidth(item, maxIntersection) {
  return 1.4 + ((item.intersection_count || 0) / Math.max(1, maxIntersection)) * 6.2;
}

function edgeOpacity(item, maxIntersection) {
  return 0.12 + ((item.intersection_count || 0) / Math.max(1, maxIntersection)) * 0.68;
}

function buildQuerySimilarityLayout(overlap, focusVectorId) {
  const focusQuery = overlap.queries.find((query) => query.vector_id === focusVectorId) || overlap.queries[0];
  if (!focusQuery) {
    return {
      focusQuery: null,
      focusPairs: [],
      positivePairs: [],
      zeroPairs: [],
      pairMap: new Map(),
      positions: new Map(),
      maxIntersection: 1,
    };
  }
  const focusPairs = overlap.pairwise
    .filter((item) => pairMatchesFocus(item, focusQuery.vector_id))
    .map((item) => ({
      ...item,
      other_vector_id: otherVectorId(item, focusQuery.vector_id),
      other_label: otherLabel(item, focusQuery.vector_id),
    }))
    .sort((a, b) => b.intersection_count - a.intersection_count || b.jaccard - a.jaccard);

  const pairMap = new Map();
  overlap.pairwise.forEach((item) => {
    pairMap.set([item.left_vector_id, item.right_vector_id].sort().join("::"), item);
  });

  const positivePairs = focusPairs.filter((item) => item.intersection_count > 0);
  const zeroPairs = focusPairs.filter((item) => item.intersection_count === 0);
  const maxIntersection = Math.max(
    1,
    ...focusPairs.map((item) => item.intersection_count),
    ...overlap.database_overlaps.map((item) => item.intersection_count)
  );

  const positions = new Map();
  const focusComputed = {
    x: 360,
    y: 360,
    r: 122,
    ghost: false,
    query: focusQuery,
  };
  positions.set(focusQuery.vector_id, {
    ...focusComputed,
    ...(overlapPositionOverrides.get(focusQuery.vector_id) || {}),
  });

  const positiveColumns = Math.max(1, Math.ceil(Math.sqrt(positivePairs.length)));
  const positiveRows = Math.max(1, Math.ceil(positivePairs.length / positiveColumns));
  const positiveStartX = 700;
  const positiveEndX = 1180;
  const positiveStartY = 170;
  const positiveEndY = 700;
  const columnGap = (positiveEndX - positiveStartX) / Math.max(1, positiveColumns - 1);
  const rowGap = (positiveEndY - positiveStartY) / Math.max(1, positiveRows - 1);
  positivePairs.forEach((pair, index) => {
    const query = overlap.queries.find((item) => item.vector_id === pair.other_vector_id);
    const row = Math.floor(index / positiveColumns);
    const col = index % positiveColumns;
    const computed = {
      x: positiveStartX + col * columnGap,
      y: positiveStartY + row * rowGap,
      r: 46 + (pair.intersection_count / maxIntersection) * 34,
      ghost: false,
      query,
      pair,
    };
    positions.set(pair.other_vector_id, {
      ...computed,
      ...(overlapPositionOverrides.get(pair.other_vector_id) || {}),
    });
  });

  zeroPairs.forEach((pair, index) => {
    const query = overlap.queries.find((item) => item.vector_id === pair.other_vector_id);
    const ghostColumns = Math.max(1, Math.ceil(Math.sqrt(zeroPairs.length)));
    const computed = {
      x: 690 + (index % ghostColumns) * Math.min(90, 500 / Math.max(1, ghostColumns - 1)),
      y: 800 + Math.floor(index / ghostColumns) * 48,
      r: 20,
      ghost: true,
      query,
      pair,
    };
    positions.set(pair.other_vector_id, {
      ...computed,
      ...(overlapPositionOverrides.get(pair.other_vector_id) || {}),
    });
  });

  return {
    focusQuery,
    focusPairs,
    positivePairs,
    zeroPairs,
    pairMap,
    positions,
    maxIntersection,
  };
}

function renderOverlapStage(overlap, focusVectorId) {
  overlapStage.innerHTML = "";
  const layout = buildQuerySimilarityLayout(overlap, focusVectorId);
  const { focusQuery, positions, pairMap, maxIntersection } = layout;
  if (!focusQuery) return;

  currentOverlapFocus = focusQuery.vector_id;

  overlapStage.appendChild(createText(224, 84, "overlap-kicker", "Similarity Graph"));
  overlapStage.appendChild(
    createText(224, 118, "overlap-note", "Weighted edges show shared people between query vectors.")
  );
  overlapStage.appendChild(
    createText(1260, 84, "overlap-kicker", "Current Database"))
  ;
  overlapStage.appendChild(createText(1260, 118, "overlap-note", overlap.database_info.note));

  const dbNode = overlap.database_overlaps.find((item) => item.vector_id === focusQuery.vector_id);
  const dbOverride = overlapPositionOverrides.get("database");
  const dbX = dbOverride?.x ?? 1365;
  const dbY = dbOverride?.y ?? 330;
  const focusPos = positions.get(focusQuery.vector_id);
  const dbRadius = dbNode ? 118 + Math.min(44, dbNode.intersection_count * 2.6) : 118;
  const dbPosition = { x: dbX, y: dbY, r: dbRadius };

  overlap.queries.forEach((query) => {
    if (query.vector_id === focusQuery.vector_id) return;
    const pos = positions.get(query.vector_id);
    if (!pos) return;

    const pair = pos.pair;
    const points = absoluteCircleEndpoints(focusPos, pos, focusPos.r, pos.r, 6);
    const line = createSvgElement("line", {
      x1: points.x1,
      y1: points.y1,
      x2: points.x2,
      y2: points.y2,
      class: `similarity-edge ${pair?.intersection_count > 0 ? "active" : "ghost"}`,
      "stroke-width": pair ? edgeStrokeWidth(pair, maxIntersection) : 1,
      "stroke-opacity": pair?.intersection_count > 0 ? edgeOpacity(pair, maxIntersection) : 0.04,
    });
    overlapStage.appendChild(line);

    if (pair?.intersection_count > 0) {
      const metric = createText(
        (positions.get(focusQuery.vector_id).x + pos.x) / 2,
        (positions.get(focusQuery.vector_id).y + pos.y) / 2 - 8,
        "similarity-edge-label",
        `${pair.intersection_count}`
      );
      overlapStage.appendChild(metric);
    }
  });

  const peerIds = overlap.queries
    .map((query) => query.vector_id)
    .filter((vectorId) => vectorId !== focusQuery.vector_id);

  peerIds.forEach((leftId, leftIndex) => {
    peerIds.slice(leftIndex + 1).forEach((rightId) => {
      const pair = pairMap.get([leftId, rightId].sort().join("::"));
      if (!pair || pair.intersection_count <= 0) return;
      const leftPos = positions.get(leftId);
      const rightPos = positions.get(rightId);
      if (!leftPos || !rightPos || leftPos.ghost || rightPos.ghost) return;
      const points = absoluteCircleEndpoints(leftPos, rightPos, leftPos.r, rightPos.r, 4);

      const peerEdge = createSvgElement("line", {
        x1: points.x1,
        y1: points.y1,
        x2: points.x2,
        y2: points.y2,
        class: "similarity-edge peer-link",
        "stroke-width": clamp(pair.jaccard * 10, 0.8, 3.2),
        "stroke-opacity": clamp(pair.jaccard * 1.2, 0.08, 0.32),
      });
      overlapStage.appendChild(peerEdge);
    });
  });

  overlap.queries.forEach((query) => {
    const pos = positions.get(query.vector_id);
    if (!pos) return;
    const overlapCount =
      query.vector_id === focusQuery.vector_id ? query.result_count : pos.pair?.intersection_count ?? 0;
    const node = createSvgElement("g", {
      class: `similarity-node ${query.vector_id === focusQuery.vector_id ? "focus" : ""} ${pos.ghost ? "ghost" : "peer"}`,
      transform: `translate(${pos.x}, ${pos.y})`,
      "data-vector-id": query.vector_id,
    });

    node.appendChild(
      createSvgElement("circle", {
        r: pos.r,
        class: `overlap-circle ${query.vector_id === focusQuery.vector_id ? "focus" : "peer"}`,
      })
    );
    node.appendChild(createText(0, -8, "overlap-label", query.short_label));
    node.appendChild(createText(0, 16, "overlap-count", `${overlapCount}`));
    node.appendChild(
      createText(
        0,
        38,
        pos.ghost ? "overlap-subtext overlap-ghost-label" : "overlap-subtext",
        pos.ghost ? "no overlap" : truncate(query.label.replace(`${query.short_label} `, ""), 24)
      )
    );
    node.addEventListener("click", () => {
      if (overlapDraggedNodeId === query.vector_id) {
        overlapDraggedNodeId = null;
        return;
      }
      currentOverlapDetail = { type: "query", id: query.vector_id };
      overlapFocusSelect.value = query.vector_id;
      renderOverlapStage(overlap, query.vector_id);
    });
    node.addEventListener("mousedown", (event) => {
      event.stopPropagation();
      overlapNodeDragState = {
        elementId: query.vector_id,
        startX: event.clientX,
        startY: event.clientY,
        startPos: { x: pos.x, y: pos.y },
        moved: false,
      };
    });
    overlapStage.appendChild(node);
  });

  if (dbNode) {
    overlap.queries.forEach((query) => {
      const dbItem = overlap.database_overlaps.find((item) => item.vector_id === query.vector_id);
      const pos = positions.get(query.vector_id);
      if (!dbItem || !pos) return;
      const hasDbOverlap = dbItem.intersection_count > 0;
      const points = absoluteCircleEndpoints(
        pos,
        dbPosition,
        pos.r,
        dbPosition.r,
        6
      );
      const line = createSvgElement("line", {
        x1: points.x1,
        y1: points.y1,
        x2: points.x2,
        y2: points.y2,
        class: `database-edge ${hasDbOverlap ? "active" : "ghost"}`,
        "stroke-width": hasDbOverlap ? 1.3 + (dbItem.intersection_count / maxIntersection) * 5 : 0.8,
        "stroke-opacity": hasDbOverlap ? 0.2 + (dbItem.intersection_count / maxIntersection) * 0.55 : 0.04,
      });
      overlapStage.appendChild(line);
    });

    const dbGroup = createSvgElement("g", {
      class: "similarity-node database-node",
      transform: `translate(${dbX}, ${dbY})`,
      "data-node-id": "database",
    });
    dbGroup.appendChild(
      createSvgElement("circle", {
        r: dbRadius,
        class: "overlap-circle database",
      })
    );
    dbGroup.appendChild(createText(0, -12, "overlap-label", "Database"));
    dbGroup.appendChild(createText(0, 18, "overlap-count", `${dbNode.intersection_count}`));
    dbGroup.appendChild(createText(0, 44, "overlap-subtext", "shared with focus query"));
    dbGroup.addEventListener("click", () => {
      if (overlapDraggedNodeId === "database") {
        overlapDraggedNodeId = null;
        return;
      }
      currentOverlapDetail = { type: "database" };
      renderDatabaseDetails(dbNode, overlap);
    });
    dbGroup.addEventListener("mousedown", (event) => {
      event.stopPropagation();
      overlapNodeDragState = {
        elementId: "database",
        startX: event.clientX,
        startY: event.clientY,
        startPos: { x: dbX, y: dbY },
        moved: false,
      };
    });
    overlapStage.appendChild(dbGroup);
  }

  overlapStage.appendChild(createText(845, 905, "overlap-note", "Ghost nodes = zero direct overlap with the current focus query"));

  renderPairwiseCards(overlap, focusQuery.vector_id);
  renderDatabaseCards(overlap);
  if (currentOverlapDetail?.type === "database" && dbNode) {
    renderDatabaseDetails(dbNode, overlap);
  } else if (currentOverlapDetail?.type === "query") {
    const detailQuery = overlap.queries.find((query) => query.vector_id === currentOverlapDetail.id);
    if (detailQuery) {
      renderOverlapDetails(detailQuery, overlap);
    } else {
      renderOverlapDetails(focusQuery, overlap);
    }
  } else if (autoSelectOverlapDetail) {
    currentOverlapDetail = { type: "query", id: focusQuery.vector_id };
    renderOverlapDetails(focusQuery, overlap);
  } else {
    renderDetails(null);
  }
  autoSelectOverlapDetail = false;
}

function renderOverlap(overlap) {
  currentOverlap = overlap;
  renderOverlapStats(overlap);
  runMeta.textContent = `${overlap.run_id} • strongest pair overlap ${overlap.stats.strongest_pair_overlap} • db ${overlap.database_info.record_count}`;
  populateOverlapFocus(overlap);
  const focusVectorId = overlapFocusSelect.value || overlap.queries[0]?.vector_id;
  if (focusVectorId) {
    overlapFocusSelect.value = focusVectorId;
    renderOverlapStage(overlap, focusVectorId);
  }
}

function applyViewportTransform() {
  viewport.setAttribute("transform", `translate(${pan.x} ${pan.y}) scale(${zoom})`);
}

function changeZoom(delta) {
  zoom = Math.min(5, Math.max(0.2, zoom + delta));
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
  currentSelection = null;
  currentEdgeSelection = null;
  nodePositionOverrides = new Map();
  autoSelectGraphNode = true;
  resetViewport();
  renderGraph(graph);
}

async function loadAggregate() {
  const graph = await fetchJson("/api/aggregate");
  currentSelection = null;
  currentEdgeSelection = null;
  nodePositionOverrides = new Map();
  queryResultsCache.clear();
  queryOverlapCache.clear();
  autoSelectGraphNode = true;
  resetViewport();
  renderGraph(graph);
}

async function loadSeedSearches() {
  const graph = await fetchJson("/api/seed-searches");
  currentSelection = null;
  currentEdgeSelection = null;
  nodePositionOverrides = new Map();
  queryResultsCache.clear();
  queryOverlapCache.clear();
  autoSelectGraphNode = true;
  resetViewport();
  renderGraph(graph);
}

async function loadOverlap(runId = null) {
  const url = runId ? `/api/overlap?run_id=${encodeURIComponent(runId)}` : "/api/overlap/latest";
  const overlap = await fetchJson(url);
  overlapPositionOverrides = new Map();
  currentOverlapDetail = null;
  autoSelectOverlapDetail = true;
  clearInspector();
  renderOverlap(overlap);
}

function applyViewMode() {
  const isGraph = activeView() === "graph";
  const isAggregate = activeView() === "aggregate";
  const isSeedSearches = activeView() === "seed-searches";
  const isGraphView = isGraph || isAggregate || isSeedSearches;
  svg.classList.toggle("hidden", !isGraphView);
  overlapView.classList.toggle("hidden", isGraphView);
  graphZoomControls.classList.toggle("hidden", !isGraphView);
  graphLegend.classList.toggle("hidden", !isGraphView);
  overlapLegend.classList.toggle("hidden", isGraphView);
  overlapControls.classList.toggle("hidden", isGraphView);
  runSelect.disabled = isAggregate || isSeedSearches;
  if (!isGraphView) {
    runColorLegend.classList.add("hidden");
  }
}

function initPanAndZoom() {
  svg.addEventListener("mousedown", (event) => {
    if (event.target.closest(".node")) return;
    svg.classList.add("dragging");
    dragState = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y, moved: false };
  });

  window.addEventListener("mousemove", (event) => {
    if (nodeDragState && currentGraph) {
      const dx = (event.clientX - nodeDragState.startX) / zoom;
      const dy = (event.clientY - nodeDragState.startY) / zoom;
      const nextX = clamp(nodeDragState.startPos.x + dx, 140, viewBox.width - 140);
      const nextY = clamp(nodeDragState.startPos.y + dy, 140, viewBox.height - 140);
      nodePositionOverrides.set(nodeDragState.nodeId, { x: nextX, y: nextY });
      nodeDragState.moved = nodeDragState.moved || Math.abs(dx) > 2 || Math.abs(dy) > 2;
      scheduleGraphRender();
      return;
    }
    if (overlapNodeDragState && currentOverlap) {
      const dx = event.clientX - overlapNodeDragState.startX;
      const dy = event.clientY - overlapNodeDragState.startY;
      const nextX = clamp(overlapNodeDragState.startPos.x + dx, 180, 1480);
      const nextY = clamp(overlapNodeDragState.startPos.y + dy, 130, 900);
      overlapPositionOverrides.set(overlapNodeDragState.elementId, { x: nextX, y: nextY });
      overlapNodeDragState.moved =
        overlapNodeDragState.moved || Math.abs(dx) > 2 || Math.abs(dy) > 2;
      renderOverlapStage(currentOverlap, currentOverlapFocus || currentOverlap.queries[0]?.vector_id);
      return;
    }
    if (!dragState) return;
    const dx = event.clientX - dragState.x;
    const dy = event.clientY - dragState.y;
    dragState.moved = dragState.moved || Math.abs(dx) > 2 || Math.abs(dy) > 2;
    pan = { x: dragState.panX + dx, y: dragState.panY + dy };
    applyViewportTransform();
  });

  window.addEventListener("mouseup", () => {
    if (nodeDragState?.moved) {
      draggedNodeId = nodeDragState.nodeId;
    }
    if (overlapNodeDragState?.moved) {
      overlapDraggedNodeId = overlapNodeDragState.elementId;
    }
    if (dragState && !dragState.moved && activeView() !== "overlap") {
      clearInspector();
      highlightSelection(null);
    }
    nodeDragState = null;
    overlapNodeDragState = null;
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
  if (activeView() === "seed-searches") {
    await loadSeedSearches();
  } else if (activeView() === "graph") {
    await loadGraph(runSelect.value);
  } else if (activeView() === "aggregate") {
    await loadAggregate();
  } else {
    await loadOverlap(runSelect.value);
  }
});

runSelect.addEventListener("change", async () => {
  if (activeView() === "seed-searches") {
    await loadSeedSearches();
  } else if (activeView() === "graph") {
    await loadGraph(runSelect.value);
  } else if (activeView() === "aggregate") {
    await loadAggregate();
  } else {
    await loadOverlap(runSelect.value);
  }
});

viewSelect.addEventListener("change", async () => {
  resetViewport();
  applyViewMode();
  if (activeView() === "seed-searches") {
    await loadSeedSearches();
  } else if (activeView() === "graph") {
    await loadGraph(runSelect.value);
  } else if (activeView() === "aggregate") {
    await loadAggregate();
  } else {
    await loadOverlap(runSelect.value);
  }
});

overlapFocusSelect.addEventListener("change", () => {
  if (currentOverlap) {
    currentOverlapDetail = { type: "query", id: overlapFocusSelect.value };
    renderOverlapStage(currentOverlap, overlapFocusSelect.value);
  }
});

overlapStage.addEventListener("click", (event) => {
  if (event.target.closest(".similarity-node, .database-node")) return;
  currentOverlapDetail = null;
  clearInspector();
});

zoomInButton.addEventListener("click", () => changeZoom(0.12));
zoomOutButton.addEventListener("click", () => changeZoom(-0.12));
zoomResetButton.addEventListener("click", resetViewport);

async function main() {
  initPanAndZoom();
  applyViewportTransform();
  applyViewMode();
  await loadRuns();
  if (activeView() === "seed-searches") {
    await loadSeedSearches();
  } else if (activeView() === "graph") {
    await loadGraph(runSelect.value);
  } else if (activeView() === "aggregate") {
    await loadAggregate();
  } else {
    await loadOverlap(runSelect.value);
  }
}

main().catch((error) => {
  runMeta.textContent = `Failed to load graph: ${error.message}`;
  detailPanel.innerHTML = `<div class="placeholder">${error.message}</div>`;
});

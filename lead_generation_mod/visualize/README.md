# Visualize

This folder contains local visualizations for Exa run outputs.

## What It Shows

- the seed person in the center
- every query saved with a run, regardless of how many templates currently exist
- person nodes connected to the query or queries that returned them
- node colors for accepted and dropped candidates
- a second overlap view for query-to-query overlap
- query-to-database overlap against the current `data/leads.json`

## Run It

From the repo root:

```bash
python3 -m visualize.server
```

Then open:

```text
http://127.0.0.1:8765
```

The UI loads the latest run from `data/` by default, and you can switch between runs from the sidebar.

## Views

- `Seed searches`
  Default aggregate view showing only search/seed personas, with lineage edges that preserve the producing queries that led to later seeds.
- `Graph view`
  Obsidian-inspired network layout with the seed person in the center.
- `All searches`
  Aggregates saved runs with stable per-search colors. Query nodes are connected when they share at least one person, and selecting an overlap line loads the shared people. Person nodes are rendered only when they appear in at least three distinct queries or are used as later seeds.
- `Overlap view`
  Venn-inspired overlap layout focused on one query at a time, showing:
  query overlap with other query vectors and overlap with the current lead database.

## Scaling Behavior

- historical runs use their saved `queries.json`, so removing a current template does not break old visualizations
- the default seed-searches view keeps only seed personas on the canvas while preserving producing-query provenance in the inspector
- aggregate query result lists are fetched only when selected
- aggregate query-overlap details are fetched only when an overlap line is selected
- aggregate person nodes are limited to people appearing in at least three queries, always preserving seed lineage
- aggregate seed nodes use their search color while their query nodes use a distinct companion color
- when a person discovered by an earlier query becomes a later seed, a dashed directional arrow links that producing query to the seed
- positive query-overlap edges are ranked by shared-person count and capped at `25,000` only when a graph exceeds that limit
- dense aggregate graphs reduce labels, hover work, and person edges automatically

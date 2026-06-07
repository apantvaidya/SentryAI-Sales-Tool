# Visualize

This folder contains a local graph visualization for Exa run outputs.

## What It Shows

- the seed person in the center
- the seven query vectors around the seed
- person nodes connected to the query or queries that returned them
- node colors for accepted, needs review, and dropped candidates

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

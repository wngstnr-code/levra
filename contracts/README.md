# Contracts

Foundry project for the Levra contracts. Owner: Wangsit.

## Setup

```bash
git submodule update --init --recursive
make build
```

## Commands

| Command | What it does |
|---|---|
| `make build` | Compile |
| `make abis` | Compile, then write the ABIs to `packages/shared/abis/` |
| `make fmt` | Format |

Run `make abis` after any change to an interface and commit the result in the same PR.

## Interfaces

The interfaces in `src/interfaces/` are the contract side of the interface agreement in `docs/03-interfaces.md`. Changing them follows the interface change process in `docs/06-team-workflow.md`.

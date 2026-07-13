# Governance

untilgreen is currently a **maintainer-led** project (single lead maintainer,
pre-1.0). This document states how decisions are made now and how that
changes as the project grows.

## Roles

- **Lead maintainer** — final say on design questions and releases;
  custodian of the constitution's invariants.
- **Maintainers** — commit access; review and merge PRs; added by consensus
  of existing maintainers after a track record of quality contributions.
- **Contributors** — anyone with a merged PR.

## How decisions are made

- Day-to-day changes: PR review, one maintainer approval.
- Architectural changes: an ADR in `docs/adr/` proposed via PR; lazy
  consensus (72h without objections from a maintainer) or lead maintainer
  decision on deadlock.
- Constitution invariants: changing one requires an ADR **and** explicit
  lead-maintainer approval. These exist to keep the project's identity from
  eroding one reasonable-looking PR at a time.

## Graduation plan

When the project has ≥3 active maintainers from ≥2 organizations, this
document is to be revisited: decision-making moves to a maintainer vote
model, and the lead-maintainer veto is dropped except for the constitution
invariants.

## Licensing

Apache-2.0, inbound = outbound (DCO sign-off, no CLA).

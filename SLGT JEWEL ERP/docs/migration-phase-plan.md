# Migration Phase Plan — Embedded Local-First

**Branch:** `migration/local-first-sqlite`  
**Rule:** End each phase with IMPLEMENT → TEST → AUDIT → DOCUMENT → CHECKPOINT. Critical failure → STOP.

| Phase | Name | Status |
|-------|------|--------|
| **A** | Current verification + backup/checkpoint | **COMPLETE** — `migration-phase-a-checkpoint.md` |
| **B** | Shared domain / repository abstraction | **COMPLETE** — `migration-phase-b-checkpoint.md` |
| **C** | Embedded SQLite + migrations | **COMPLETE** — `migration-phase-c-checkpoint.md` |
| **D** | Local operational data + cloud snapshot | NOT STARTED |
| **E** | Local billing/inventory TX engine | NOT STARTED |
| **F** | Cloud event sync | NOT STARTED |
| **G** | Cloud coordination for conflicting sales | NOT STARTED |
| **H** | LAN discovery / auth / event replication | NOT STARTED |
| **I** | LAN pre-commit coordination | NOT STARTED |
| **J** | Connectivity state machine + isolated mode | NOT STARTED |
| **K** | Device join / catch-up | NOT STARTED |
| **L** | Audit / anti-fraud | NOT STARTED |
| **M** | Backup / recovery | NOT STARTED |
| **N** | Electron production packaging | NOT STARTED |
| **O** | Old Branch/PostgreSQL runtime cleanup | NOT STARTED (only after gates) |
| **P** | Full acceptance / failure testing | NOT STARTED |

## Required docs (created as phases complete)

| Doc | Phase |
|-----|-------|
| `local-first-architecture.md` | A |
| `migration-phase-a-checkpoint.md` | A |
| `sqlite-schema.md` | C |
| `sync-protocol.md` | F |
| `lan-coordination.md` | H–I |
| `connectivity-state-machine.md` | J |
| `device-security.md` | K |
| `invoice-numbering-design.md` | E (design before impl) |
| `audit-security.md` | L |
| `desktop-backup-recovery.md` | M |
| `removed-branch-architecture.md` | O |
| `migration-final-report.md` | P |

## Non-negotiable

- Do **not** delete Branch/local PG path until Phase O gates pass.  
- Do **not** destroy cloud PostgreSQL data.  
- Do **not** use whole-DB dump as sync.  
- Do **not** use LWW for invoices/payments/movements.

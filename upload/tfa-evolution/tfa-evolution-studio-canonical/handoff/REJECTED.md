# Rejected Paths
Ruled out by PRD or current source for this alpha release.

| # | Path | Why rejected |
|---|---|---|
| R1 | User authentication / login | Explicitly out of scope in PRD §7; alpha is single-user/no-auth. |
| R2 | Multi-user support | Out of scope; backend has no user concept in client types. |
| R3 | Push notifications for workflow state changes | Out of scope; polling is the chosen mechanism. |
| R4 | In-app code editor or diff viewer | Out of scope; file explorer is read-only. |
| R5 | Custom agent configuration / editing | Out of scope; agent config is read-only in alpha. |
| R6 | Workflow scheduling / automation | Out of scope; evolutions are launched manually. |
| R7 | Export audit logs | Out of scope for alpha; audit screen is read-only. |
| R8 | Light theme toggle | Out of scope; dark-only design. |
| R9 | Localization / multi-language | Out of scope; English only. |
| R10 | Biometric authentication | Out of scope; no auth at all. |
| R11 | Integration with external version control (GitHub/GitLab) | Out of scope; projects are ZIP-based. |
| R12 | Workflow cloning / duplication | Out of scope; launch flow is always from a project+version. |
| R13 | Batch operations on multiple workflows | Out of scope; single-workflow actions only. |
| R14 | Advanced filtering and sorting beyond basic project filter | Out of scope in PRD §7; only basic project filter in Vault. |
| R15 | Workflow pause/resume functionality | Out of scope; lifecycle is launch → approve/reject → complete/fail. |
| R16 | File preview inside File Explorer | Out of scope; read-only tree only. |

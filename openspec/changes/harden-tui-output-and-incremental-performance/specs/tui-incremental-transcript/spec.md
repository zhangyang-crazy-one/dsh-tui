## ADDED Requirements

### Requirement: Active updates do not copy settled history

For unchanged settled history and geometry, active-turn deltas SHALL update only changed blocks and presentation metadata. They MUST NOT clone all settled maps, enumerate all historical signatures or reproject unchanged history. Canonical events SHALL remain complete even when obsolete presentation requests are coalesced before projection.

#### Scenario: Fixed delta across increasing histories
- **WHEN** the same active block and delta sequence are replayed with 100, 1,000 and 10,000 unchanged settled entries at fixed viewport size
- **THEN** instrumentation shows no per-delta full settled-map copying or historical-signature enumeration, and the visible result matches the full projection reference

#### Scenario: A burst contains superseded presentation snapshots
- **WHEN** multiple canonical deltas arrive before the next presentation opportunity
- **THEN** the event model retains every delta while only the required latest presentation state is projected, and final settled content matches the event model

### Requirement: Responsive exact initial presentation

The renderer SHALL make the visible tail and input interactive without synchronously laying out all offscreen history. Deferred work SHALL preserve exact content and scroll anchoring, and SHALL reject obsolete session or geometry revisions. Existing scroll and overscan requirements remain in force.

#### Scenario: Opening a long session
- **WHEN** a session with 10,000 entries opens with a tail viewport
- **THEN** instrumentation records the first interactive frame before full offscreen projection finishes, visible content is exact, and subsequent background indexing does not move the user's anchor

#### Scenario: Resize or session switch during indexing
- **WHEN** geometry or session identity changes before queued history work completes
- **THEN** old work cannot paint or repopulate invalid scopes, and scrolling or expanding a summary produces the same content and anchor as the full reference projection

### Requirement: Derived cache lifecycle and accounting

Every derived cache SHALL declare its owner, scope, pin rules, budget and invalidation events. Removing history or replacing geometry/session scopes SHALL release obsolete projections and auxiliary indexes. Accounting SHALL distinguish canonical history, valid metadata, evictable caches, required pinned data and pending output rather than describing one store as total memory.

#### Scenario: Repeated compaction, width changes and session replacement
- **WHEN** repeated history compaction, width changes and session replacement occur within one mounted renderer lifecycle
- **THEN** obsolete owner/scope references become collectible, cache counts return to the declared budgets except separately reported required pins, and canonical content remains reconstructable

#### Scenario: Physical-line eviction with other cache layers alive
- **WHEN** physical rows are evicted while other projection layers retain data
- **THEN** statistics expose those remaining layers and a controlled heap inspection can attribute retained derived data without claiming it was freed by line-store eviction alone

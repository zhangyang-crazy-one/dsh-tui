## ADDED Requirements

### Requirement: Animation updates remain local

Generating animation ticks SHALL update only their owning presentation components when canonical content, geometry and other state are unchanged. They MUST NOT cause transcript projection, composer tokenization or unrelated pane snapshot reconstruction.

#### Scenario: Generating while awaiting the next delta
- **WHEN** the generating status persists through multiple spinner ticks without a content or geometry change
- **THEN** the spinner advances while instrumentation records no tick-induced transcript projection, composer tokenization or unrelated pane reconstruction

### Requirement: Dependency scoped snapshot invalidation

Runtime mutations SHALL invalidate only snapshots whose declared dependencies changed, preserve unrelated snapshot identity and notify observers after the mutation is consistently applied. Cross-domain actions MUST update all affected views.

#### Scenario: Settings selection moves
- **WHEN** only a settings selection changes
- **THEN** the selected row updates while chat model and unrelated panel snapshots retain their identities

#### Scenario: A generation event opens an approval pane
- **WHEN** an event changes both run state and approval state
- **THEN** both affected snapshots update consistently and keyboard focus follows the existing approval contract without waiting for an unrelated animation tick

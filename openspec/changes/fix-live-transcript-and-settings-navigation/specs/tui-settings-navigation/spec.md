## ADDED Requirements

### Requirement: Hierarchical settings navigation
Settings SHALL expose categories, namespaces, nested objects and arrays as navigable levels, including providers and model definitions. Search and back navigation SHALL retain stable selection. Successful edits SHALL retain the current location.

#### Scenario: Edit nested model configuration
- **WHEN** a user opens a provider model and edits one nested array value
- **THEN** the official settings service receives the update, sibling and unknown user fields are retained, and the current location stays open

### Requirement: Bounded settings layout
Settings rows and actions SHALL fit the available physical row and column budget at 40, 80 and 120 columns.

#### Scenario: Long provider paths on a narrow terminal
- **WHEN** the settings panel is 40 columns wide
- **THEN** hierarchy shortens field labels, selected values remain visible and navigation controls remain within the pane

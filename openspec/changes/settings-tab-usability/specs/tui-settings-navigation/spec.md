## ADDED Requirements

### Requirement: Discoverable category tabs
The settings browser SHALL show available categories and distinguish the active category without relying on color alone. Switching categories SHALL restore each category's last valid nested location and selection.

#### Scenario: Return to a provider model
- **WHEN** a user switches away from a model field and back with Tab and Shift+Tab
- **THEN** the same model field is selected and its category remains visible

### Requirement: Readable contextual settings controls
The settings browser SHALL distinguish the selected row, expose long values in a bounded detail area, identify search result paths and show actions applicable to the selected item.

#### Scenario: Search and edit on a narrow terminal
- **WHEN** a user searches in a 40-column terminal and moves through matching fields
- **THEN** the selection, source identity and available actions remain within the viewport and the chat draft is preserved

---
name: refactor-component
description: Split a large React component into smaller, testable pieces
---

# Refactor Component

Break down an oversized React component into smaller, focused sub-components.

## Steps

1. Identify distinct UI sections rendered inside the component.
2. Extract each section into its own component file.
3. Move related state and handlers into the extracted components.
4. Create a barrel export in an index file.
5. Update the parent to compose sub-components.

## Usage

Use when a component exceeds 200 lines or handles more than 3 unrelated state values.

```jsx
// Before
function Page() {
  const [search, setSearch] = useState('');
  const [items, setItems] = useState([]);
  return <div><SearchBar .../><ItemList .../><Pagination .../></div>;
}

// After
function Page() {
  return <SearchBar /><ItemList /><Pagination />;
}
```

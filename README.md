# Todo

A small todo app with no dependencies and no build step.

## Run

Open `index.html` in a browser. Tasks are saved in the browser's `localStorage`, so they persist across reloads and stay in sync between open tabs.

## Features

- Add tasks with an optional due date and priority (low / medium / high)
- Complete, edit (double-click or the pencil button), and delete tasks
- Undo for deletes and "Clear done"
- Filter by All / Active / Done, search, and sort by added order, due date, or priority
- Overdue tasks are highlighted; "Mark all done" toggles everything at once
- Keyboard: <kbd>N</kbd> focuses the new-task box, <kbd>/</kbd> focuses search, <kbd>Esc</kbd> cancels an edit or clears search
- Light and dark themes follow the system setting; works at phone widths

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Markup and item templates |
| `styles.css` | Styling and themes |
| `store.js` | Pure list logic (add, update, filter, sort, validate stored data) |
| `app.js` | DOM rendering, events, persistence, undo |
| `test/store.test.js` | Unit tests for `store.js` |

## Test

```sh
npm test
```

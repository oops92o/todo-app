(function () {
  'use strict';

  const Store = window.TodoStore;
  const STORAGE_KEY = 'todo-app:v1';
  const TOAST_MS = 6000;
  const PRIORITY_BADGE = { high: 'High', low: 'Low' }; // medium is the default, so it gets no badge
  const FOCUSABLE_IN_ITEM = ['.todo-toggle', '[data-action="edit"]', '[data-action="delete"]', '.edit-text', '.edit-due', '.edit-priority'];

  const $ = (selector) => document.querySelector(selector);
  const els = {
    form: $('#new-todo-form'),
    text: $('#new-todo-text'),
    due: $('#new-todo-due'),
    priority: $('#new-todo-priority'),
    filters: document.querySelectorAll('[data-filter]'),
    search: $('#search'),
    sort: $('#sort'),
    toggleAll: $('#toggle-all'),
    clearCompleted: $('#clear-completed'),
    list: $('#todo-list'),
    empty: $('#empty-state'),
    summary: $('#summary'),
    itemTemplate: $('#todo-item-template'),
    editTemplate: $('#todo-edit-template'),
    toast: $('#toast'),
    toastMessage: $('#toast-message'),
    toastUndo: $('#toast-undo'),
  };

  const state = {
    todos: [],
    filter: 'all',
    sort: 'manual',
    query: '',
    editingId: null,
    draft: null, // unsaved editor values, kept across re-renders
  };

  let undoSnapshot = null;
  let toastTimer = null;

  // ---- persistence -------------------------------------------------------

  function readStorage() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      return data && typeof data === 'object' ? data : null;
    } catch {
      return null; // storage blocked or corrupt: start fresh
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 1,
        todos: state.todos,
        filter: state.filter,
        sort: state.sort,
      }));
    } catch {
      // Private mode / quota: the app still works for this session.
    }
  }

  // ---- state changes -----------------------------------------------------

  function commit(todos, undoMessage) {
    const previous = state.todos;
    state.todos = todos;
    if (state.editingId && !todos.some((t) => t.id === state.editingId)) stopEditingState();
    save();
    render();
    if (undoMessage) showToast(undoMessage, previous);
    else hideToast();
  }

  function addFromForm() {
    const input = { text: els.text.value, due: els.due.value, priority: els.priority.value };
    const next = Store.addTodo(state.todos, input);
    if (next === state.todos) {
      els.text.value = '';
      els.text.focus();
      return;
    }
    // Make sure the new task is actually visible under the current filter/search.
    const added = next[next.length - 1];
    if (!Store.visibleTodos([added], state).length) {
      state.filter = 'all';
      state.query = '';
      els.search.value = '';
    }
    commit(next);
    els.form.reset();
    els.text.focus();
  }

  function deleteTodo(id) {
    const todo = state.todos.find((t) => t.id === id);
    if (!todo) return;
    commit(Store.removeTodo(state.todos, id), `Deleted “${truncate(todo.text, 40)}”`);
  }

  function startEdit(id) {
    readDraft();
    state.editingId = id;
    state.draft = null;
    render();
    const input = els.list.querySelector('.edit-text');
    if (input) {
      input.focus();
      input.select();
    }
  }

  function stopEditingState() {
    state.editingId = null;
    state.draft = null;
  }

  function cancelEdit() {
    stopEditingState();
    render();
  }

  function saveEdit(form) {
    const id = state.editingId;
    const values = { text: form.elements.text.value, due: form.elements.due.value, priority: form.elements.priority.value };
    stopEditingState();
    if (!Store.cleanText(values.text)) {
      deleteTodo(id); // clearing a task's text removes it (with undo)
      return;
    }
    commit(Store.updateTodo(state.todos, id, values));
  }

  function setFilter(filter) {
    if (!Store.FILTERS.includes(filter)) return;
    state.filter = filter;
    save();
    render();
  }

  // ---- rendering ---------------------------------------------------------

  function render() {
    readDraft();
    const focus = captureFocus();
    const today = Store.toISODate();
    const visible = Store.visibleTodos(state.todos, state);

    els.list.replaceChildren(...visible.map((todo) =>
      todo.id === state.editingId ? renderEditor(todo) : renderItem(todo, today)));

    const { total, active, completed } = Store.getStats(state.todos);
    els.summary.textContent = total === 0
      ? 'Nothing here yet'
      : active === 0
        ? `All ${total} done`
        : `${active} of ${total} left`;

    const counts = { all: total, active, completed };
    els.filters.forEach((button) => {
      const filter = button.dataset.filter;
      button.setAttribute('aria-pressed', String(filter === state.filter));
      button.querySelector('.count').textContent = counts[filter];
    });

    els.toggleAll.checked = total > 0 && active === 0;
    els.toggleAll.indeterminate = active > 0 && completed > 0;
    els.toggleAll.disabled = total === 0;
    els.clearCompleted.hidden = completed === 0;
    els.clearCompleted.textContent = `Clear done (${completed})`;
    els.sort.value = state.sort;

    els.empty.hidden = visible.length > 0;
    if (!visible.length) els.empty.textContent = emptyMessage(total);

    restoreFocus(focus);
  }

  function emptyMessage(total) {
    if (total === 0) return 'No tasks yet. Add one above to get started.';
    if (state.query) return `No tasks match “${truncate(Store.cleanText(state.query), 30)}”.`;
    if (state.filter === 'active') return 'Everything is done. Nice work.';
    if (state.filter === 'completed') return 'Nothing completed yet.';
    return 'No tasks to show.';
  }

  function renderItem(todo, today) {
    const li = els.itemTemplate.content.firstElementChild.cloneNode(true);
    const overdue = Store.isOverdue(todo, today);
    li.dataset.id = todo.id;
    li.dataset.priority = todo.priority;
    li.classList.toggle('done', todo.done);
    li.classList.toggle('overdue', overdue);

    const text = li.querySelector('.todo-text');
    text.id = `todo-text-${todo.id}`;
    text.textContent = todo.text;

    const toggle = li.querySelector('.todo-toggle');
    toggle.checked = todo.done;
    toggle.setAttribute('aria-labelledby', text.id);

    const badge = li.querySelector('.priority');
    if (PRIORITY_BADGE[todo.priority]) badge.textContent = PRIORITY_BADGE[todo.priority];
    else badge.remove();

    const due = li.querySelector('.due');
    if (todo.due) {
      due.dateTime = todo.due;
      due.textContent = dueLabel(todo.due, today, overdue);
    } else {
      due.remove();
    }
    const meta = li.querySelector('.todo-meta');
    if (!meta.children.length) meta.remove();

    li.querySelector('[data-action="edit"]').setAttribute('aria-label', `Edit “${todo.text}”`);
    li.querySelector('[data-action="delete"]').setAttribute('aria-label', `Delete “${todo.text}”`);
    return li;
  }

  function renderEditor(todo) {
    const li = els.editTemplate.content.firstElementChild.cloneNode(true);
    const values = state.draft || todo;
    li.dataset.id = todo.id;
    const form = li.querySelector('.edit-form');
    form.elements.text.value = values.text;
    form.elements.due.value = values.due || '';
    form.elements.priority.value = values.priority;
    return li;
  }

  function dueLabel(due, today, overdue) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (due === today) return 'Due today';
    if (due === Store.toISODate(tomorrow)) return 'Due tomorrow';

    const [y, m, d] = due.split('-').map(Number);
    const options = { month: 'short', day: 'numeric' };
    if (y !== new Date().getFullYear()) options.year = 'numeric';
    const label = new Date(y, m - 1, d).toLocaleDateString(undefined, options);
    return overdue ? `Overdue · ${label}` : `Due ${label}`;
  }

  // Keep in-progress edits when something else triggers a re-render.
  function readDraft() {
    const form = els.list.querySelector('.edit-form');
    if (!form || !state.editingId) return;
    state.draft = {
      text: form.elements.text.value,
      due: form.elements.due.value,
      priority: form.elements.priority.value,
    };
  }

  // The list is rebuilt on every render, so remember which control had focus
  // and put it back on the same task (or its nearest neighbour if it disappeared).
  function captureFocus() {
    const active = document.activeElement;
    const li = active && active.closest && active.closest('.todo');
    if (!li || !els.list.contains(li)) return null;
    return {
      id: li.dataset.id,
      selector: FOCUSABLE_IN_ITEM.find((selector) => active.matches(selector)) || null,
      index: Array.prototype.indexOf.call(els.list.children, li),
    };
  }

  function restoreFocus(focus) {
    if (!focus) return;
    const li = els.list.querySelector(`[data-id="${CSS.escape(focus.id)}"]`);
    if (li) {
      const target = (focus.selector && li.querySelector(focus.selector))
        || li.querySelector('.edit-text, [data-action="edit"]');
      if (target) target.focus();
      return;
    }
    const items = els.list.children;
    if (items.length) {
      items[Math.min(focus.index, items.length - 1)].querySelector('.todo-toggle, .edit-text').focus();
    } else {
      els.text.focus();
    }
  }

  // ---- toast with undo ---------------------------------------------------

  function showToast(message, snapshot) {
    undoSnapshot = snapshot;
    els.toastMessage.textContent = message;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, TOAST_MS);
  }

  function hideToast() {
    undoSnapshot = null;
    els.toast.hidden = true;
    clearTimeout(toastTimer);
  }

  function truncate(text, max) {
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }

  function idOf(element) {
    const li = element.closest('.todo');
    return li ? li.dataset.id : null;
  }

  // ---- events ------------------------------------------------------------

  els.form.addEventListener('submit', (event) => {
    event.preventDefault();
    addFromForm();
  });

  els.list.addEventListener('change', (event) => {
    if (event.target.matches('.todo-toggle')) commit(Store.toggleTodo(state.todos, idOf(event.target)));
  });

  els.list.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const id = idOf(button);
    if (button.dataset.action === 'edit') startEdit(id);
    else if (button.dataset.action === 'delete') deleteTodo(id);
    else if (button.dataset.action === 'cancel') cancelEdit();
  });

  els.list.addEventListener('dblclick', (event) => {
    const text = event.target.closest('.todo-text');
    if (text) startEdit(idOf(text));
  });

  els.list.addEventListener('submit', (event) => {
    if (!event.target.matches('.edit-form')) return;
    event.preventDefault();
    saveEdit(event.target);
  });

  els.list.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && event.target.closest('.edit-form')) {
      event.preventDefault();
      cancelEdit();
    }
  });

  els.filters.forEach((button) => {
    button.addEventListener('click', () => setFilter(button.dataset.filter));
  });

  els.search.addEventListener('input', () => {
    state.query = els.search.value;
    render();
  });

  els.sort.addEventListener('change', () => {
    if (!Store.SORTS.includes(els.sort.value)) return;
    state.sort = els.sort.value;
    save();
    render();
  });

  els.toggleAll.addEventListener('change', () => {
    commit(Store.setAllDone(state.todos, els.toggleAll.checked));
  });

  els.clearCompleted.addEventListener('click', () => {
    const { completed } = Store.getStats(state.todos);
    commit(Store.clearCompleted(state.todos), `Cleared ${completed} done ${completed === 1 ? 'task' : 'tasks'}`);
    els.text.focus();
  });

  els.toastUndo.addEventListener('click', () => {
    if (!undoSnapshot) return;
    commit(undoSnapshot);
    els.text.focus();
  });

  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    const typing = target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
    if (event.key === 'Escape' && target === els.search && els.search.value) {
      els.search.value = '';
      state.query = '';
      render();
      return;
    }
    if (typing) return;
    if (event.key === 'n' || event.key === 'N') {
      event.preventDefault();
      els.text.focus();
    } else if (event.key === '/') {
      event.preventDefault();
      els.search.focus();
    }
  });

  // Stay in sync when the app is open in more than one tab.
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;
    const data = readStorage();
    state.todos = Store.normalizeTodos(data && data.todos);
    if (state.editingId && !state.todos.some((t) => t.id === state.editingId)) stopEditingState();
    hideToast();
    render();
  });

  // ---- start -------------------------------------------------------------

  const stored = readStorage();
  if (stored) {
    state.todos = Store.normalizeTodos(stored.todos);
    if (Store.FILTERS.includes(stored.filter)) state.filter = stored.filter;
    if (Store.SORTS.includes(stored.sort)) state.sort = stored.sort;
  }
  render();
})();

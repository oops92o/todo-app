// Pure todo-list logic: no DOM, no storage. Every operation returns a new array,
// so the UI can keep the previous list around for undo.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TodoStore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PRIORITIES = ['low', 'medium', 'high'];
  const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
  const FILTERS = ['all', 'active', 'completed'];
  const SORTS = ['manual', 'due', 'priority'];
  const MAX_TEXT_LENGTH = 200;
  const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

  function createId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function cleanText(text) {
    return String(text == null ? '' : text).replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_LENGTH);
  }

  function cleanPriority(priority) {
    return PRIORITIES.includes(priority) ? priority : 'medium';
  }

  // Due dates are local calendar days stored as "YYYY-MM-DD" (what <input type="date"> produces),
  // which also makes them comparable as plain strings.
  function cleanDue(due) {
    if (typeof due !== 'string' || !DATE_PATTERN.test(due)) return null;
    const [y, m, d] = due.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const isRealDay = date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
    return isRealDay ? due : null;
  }

  function toISODate(date = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function createTodo(input, now = Date.now()) {
    const text = cleanText(input && input.text);
    if (!text) return null;
    return {
      id: createId(),
      text,
      done: false,
      priority: cleanPriority(input.priority),
      due: cleanDue(input.due),
      createdAt: now,
      completedAt: null,
    };
  }

  // Returns the same array when the input is invalid, so callers can detect a no-op.
  function addTodo(todos, input, now = Date.now()) {
    const todo = createTodo(input, now);
    return todo ? [...todos, todo] : todos;
  }

  // Empty text is ignored here; deciding that "empty means delete" is the UI's call.
  function updateTodo(todos, id, patch) {
    return todos.map((todo) => {
      if (todo.id !== id) return todo;
      const next = { ...todo };
      if ('text' in patch) {
        const text = cleanText(patch.text);
        if (text) next.text = text;
      }
      if ('priority' in patch) next.priority = cleanPriority(patch.priority);
      if ('due' in patch) next.due = cleanDue(patch.due);
      return next;
    });
  }

  function setDone(todo, done, now) {
    if (todo.done === done) return todo;
    return { ...todo, done, completedAt: done ? now : null };
  }

  function toggleTodo(todos, id, now = Date.now()) {
    return todos.map((todo) => (todo.id === id ? setDone(todo, !todo.done, now) : todo));
  }

  function setAllDone(todos, done, now = Date.now()) {
    return todos.map((todo) => setDone(todo, done, now));
  }

  function removeTodo(todos, id) {
    return todos.filter((todo) => todo.id !== id);
  }

  function clearCompleted(todos) {
    return todos.filter((todo) => !todo.done);
  }

  function isOverdue(todo, today = toISODate()) {
    return !todo.done && todo.due !== null && todo.due < today;
  }

  function compareDue(a, b) {
    if (a.due === b.due) return 0;
    if (a.due === null) return 1;
    if (b.due === null) return -1;
    return a.due < b.due ? -1 : 1;
  }

  // Array#sort is stable, so ties keep the user's manual order.
  function sortTodos(todos, sort) {
    if (sort === 'due') return [...todos].sort(compareDue);
    if (sort === 'priority') {
      return [...todos].sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || compareDue(a, b));
    }
    return [...todos];
  }

  function visibleTodos(todos, { filter = 'all', query = '', sort = 'manual' } = {}) {
    const needle = cleanText(query).toLowerCase();
    const matches = todos.filter((todo) => {
      if (filter === 'active' && todo.done) return false;
      if (filter === 'completed' && !todo.done) return false;
      return !needle || todo.text.toLowerCase().includes(needle);
    });
    return sortTodos(matches, sort);
  }

  function getStats(todos) {
    const completed = todos.filter((todo) => todo.done).length;
    return { total: todos.length, active: todos.length - completed, completed };
  }

  // Validates data read back from storage: drops junk entries, repairs fields, de-duplicates ids.
  function normalizeTodos(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const todos = [];
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const text = cleanText(item.text);
      if (!text) continue;
      let id = typeof item.id === 'string' && item.id ? item.id : createId();
      if (seen.has(id)) id = createId();
      seen.add(id);
      const done = item.done === true;
      todos.push({
        id,
        text,
        done,
        priority: cleanPriority(item.priority),
        due: cleanDue(item.due),
        createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
        completedAt: done && Number.isFinite(item.completedAt) ? item.completedAt : null,
      });
    }
    return todos;
  }

  return {
    PRIORITIES,
    FILTERS,
    SORTS,
    MAX_TEXT_LENGTH,
    cleanText,
    toISODate,
    addTodo,
    updateTodo,
    toggleTodo,
    setAllDone,
    removeTodo,
    clearCompleted,
    isOverdue,
    visibleTodos,
    getStats,
    normalizeTodos,
  };
});

const test = require('node:test');
const assert = require('node:assert/strict');
const Store = require('../store.js');

const NOW = 1_700_000_000_000;

function make(...inputs) {
  return inputs.reduce((todos, input) => Store.addTodo(todos, typeof input === 'string' ? { text: input } : input, NOW), []);
}

test('addTodo trims text, applies defaults and appends', () => {
  const todos = make('  Buy   milk  ', 'Walk dog');
  assert.equal(todos.length, 2);
  assert.equal(todos[0].text, 'Buy milk');
  assert.equal(todos[1].text, 'Walk dog');
  assert.equal(todos[0].done, false);
  assert.equal(todos[0].priority, 'medium');
  assert.equal(todos[0].due, null);
  assert.equal(todos[0].createdAt, NOW);
  assert.notEqual(todos[0].id, todos[1].id);
});

test('addTodo returns the same array for blank text', () => {
  const todos = make('a');
  assert.equal(Store.addTodo(todos, { text: '   ' }), todos);
  assert.equal(Store.addTodo(todos, {}), todos);
});

test('addTodo validates priority and due date', () => {
  const [a, b, c] = make(
    { text: 'a', priority: 'high', due: '2026-02-28' },
    { text: 'b', priority: 'urgent', due: '2026-02-30' },
    { text: 'c', due: 'tomorrow' },
  );
  assert.equal(a.priority, 'high');
  assert.equal(a.due, '2026-02-28');
  assert.equal(b.priority, 'medium');
  assert.equal(b.due, null, 'Feb 30 is not a real day');
  assert.equal(c.due, null);
});

test('addTodo caps text length', () => {
  const [todo] = make('x'.repeat(500));
  assert.equal(todo.text.length, Store.MAX_TEXT_LENGTH);
});

test('toggleTodo flips done and tracks completedAt without mutating', () => {
  const todos = make('a', 'b');
  const toggled = Store.toggleTodo(todos, todos[0].id, NOW + 1);
  assert.equal(toggled[0].done, true);
  assert.equal(toggled[0].completedAt, NOW + 1);
  assert.equal(toggled[1], todos[1], 'untouched items keep identity');
  assert.equal(todos[0].done, false, 'original is not mutated');
  const back = Store.toggleTodo(toggled, todos[0].id);
  assert.equal(back[0].done, false);
  assert.equal(back[0].completedAt, null);
});

test('updateTodo patches fields and ignores empty text', () => {
  const todos = make({ text: 'a', due: '2026-01-01', priority: 'low' });
  const id = todos[0].id;
  let next = Store.updateTodo(todos, id, { text: '  b ', priority: 'high', due: '' });
  assert.deepEqual([next[0].text, next[0].priority, next[0].due], ['b', 'high', null]);
  next = Store.updateTodo(next, id, { text: '   ' });
  assert.equal(next[0].text, 'b');
});

test('setAllDone, removeTodo and clearCompleted', () => {
  const todos = make('a', 'b', 'c');
  const allDone = Store.setAllDone(todos, true, NOW);
  assert.ok(allDone.every((t) => t.done));
  assert.deepEqual(Store.getStats(allDone), { total: 3, active: 0, completed: 3 });

  const partly = Store.toggleTodo(todos, todos[1].id);
  assert.deepEqual(Store.clearCompleted(partly).map((t) => t.text), ['a', 'c']);
  assert.deepEqual(Store.removeTodo(todos, todos[0].id).map((t) => t.text), ['b', 'c']);
});

test('visibleTodos filters by status and search text', () => {
  let todos = make('Buy milk', 'Call mom', 'Buy bread');
  todos = Store.toggleTodo(todos, todos[0].id);
  const texts = (opts) => Store.visibleTodos(todos, opts).map((t) => t.text);
  assert.deepEqual(texts({ filter: 'all' }), ['Buy milk', 'Call mom', 'Buy bread']);
  assert.deepEqual(texts({ filter: 'active' }), ['Call mom', 'Buy bread']);
  assert.deepEqual(texts({ filter: 'completed' }), ['Buy milk']);
  assert.deepEqual(texts({ query: '  BUY ' }), ['Buy milk', 'Buy bread']);
  assert.deepEqual(texts({ filter: 'active', query: 'buy' }), ['Buy bread']);
});

test('visibleTodos sorts by due date (undated last) and by priority, stably', () => {
  const todos = make(
    { text: 'no date' },
    { text: 'later', due: '2026-12-01', priority: 'low' },
    { text: 'sooner', due: '2026-11-01' },
    { text: 'urgent', priority: 'high' },
    { text: 'urgent soon', priority: 'high', due: '2026-10-11' },
  );
  const order = (sort) => Store.visibleTodos(todos, { sort }).map((t) => t.text);
  assert.deepEqual(order('manual'), ['no date', 'later', 'sooner', 'urgent', 'urgent soon']);
  assert.deepEqual(order('due'), ['urgent soon', 'sooner', 'later', 'no date', 'urgent']);
  assert.deepEqual(order('priority'), ['urgent soon', 'urgent', 'sooner', 'no date', 'later']);
});

test('isOverdue only for unfinished tasks due before today', () => {
  const [past, today, none] = make({ text: 'p', due: '2026-10-09' }, { text: 't', due: '2026-10-10' }, 'n');
  assert.equal(Store.isOverdue(past, '2026-10-10'), true);
  assert.equal(Store.isOverdue(today, '2026-10-10'), false);
  assert.equal(Store.isOverdue(none, '2026-10-10'), false);
  assert.equal(Store.isOverdue({ ...past, done: true }, '2026-10-10'), false);
});

test('toISODate uses the local calendar day', () => {
  assert.equal(Store.toISODate(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});

test('normalizeTodos repairs and filters stored data', () => {
  const result = Store.normalizeTodos([
    { id: 'x', text: ' ok ', done: true, completedAt: 5, priority: 'high', due: '2026-01-01', createdAt: 1 },
    { id: 'x', text: 'duplicate id' },
    { text: '' },
    null,
    'junk',
    { id: 7, text: 'bad fields', done: 'yes', priority: 'nope', due: 'soon', createdAt: 'then', completedAt: 9 },
  ]);
  assert.equal(result.length, 3);
  assert.deepEqual(result[0], { id: 'x', text: 'ok', done: true, priority: 'high', due: '2026-01-01', createdAt: 1, completedAt: 5 });
  assert.notEqual(result[1].id, 'x');
  assert.equal(typeof result[2].id, 'string');
  assert.equal(result[2].done, false);
  assert.equal(result[2].priority, 'medium');
  assert.equal(result[2].due, null);
  assert.equal(result[2].completedAt, null);
  assert.ok(Number.isFinite(result[2].createdAt));

  assert.deepEqual(Store.normalizeTodos(undefined), []);
  assert.deepEqual(Store.normalizeTodos({ not: 'an array' }), []);
});

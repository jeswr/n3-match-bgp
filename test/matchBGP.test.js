import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Store, DataFactory } from 'n3';
import { matchBGP, Bindings, BindingsFactory } from '../src/index.js';

const { namedNode, literal, variable, quad, defaultGraph } = DataFactory;
function ex(name) { return namedNode(`http://example.org/${name}`); }
const [s, o, g] = [variable('s'), variable('o'), variable('g')];

// Serializes a term for comparisons, as N3.js does
function id(term) {
  switch (term.termType) {
  case 'DefaultGraph': return '';
  case 'Literal': return `"${term.value}"`;
  case 'Quad': return `<<${id(term.subject)} ${id(term.predicate)} ${id(term.object)}>>`;
  default: return term.value;
  }
}

// A minimal RDF/JS DatasetCore over an array, which only offers `match`
class ArrayDataset {
  constructor(quads) { this.quads = [...quads]; }
  get size() { return this.quads.length; }
  add(q) { this.quads.push(q); return this; }
  match(subject, predicate, object, graph) {
    return new ArrayDataset(this.quads.filter(q =>
      (!subject || q.subject.equals(subject)) && (!predicate || q.predicate.equals(predicate)) &&
      (!object || q.object.equals(object)) && (!graph || q.graph.equals(graph))));
  }
  [Symbol.iterator]() { return this.quads[Symbol.iterator](); }
}

const DATA = [
  quad(ex('alice'), ex('knows'), ex('bob')),
  quad(ex('bob'), ex('knows'), ex('carol')),
  quad(ex('carol'), ex('knows'), ex('carol')),
  quad(ex('alice'), ex('name'), literal('Alice')),
  quad(ex('bob'), ex('name'), literal('Bob')),
  quad(ex('bob'), ex('name'), literal('Bobby'), ex('g1')),
];

for (const [kind, create] of [['an N3.js Store', quads => new Store(quads)],
  ['any RDF/JS dataset', quads => new ArrayDataset(quads)]]) {
  describe(`matchBGP on ${kind}`, () => {
    let dataset;
    beforeEach(() => { dataset = create(DATA); });

    function solutions(patterns, data = dataset) {
      return [...matchBGP(data, patterns)].map(bindings =>
        Object.fromEntries([...bindings].map(([key, term]) => [key.value, id(term)])));
    }
    function sorted(results) {
      return results.map(r => JSON.stringify(r)).sort().map(r => JSON.parse(r));
    }

    it('should yield one solution with no bindings for no patterns', () => {
      assert.deepEqual(solutions([]), [{}]);
    });

    it('should backtrack through branching joins', () => {
      const branching = create([
        quad(ex('r'), ex('parent'), ex('p1')), quad(ex('r'), ex('parent'), ex('p2')), quad(ex('r'), ex('parent'), ex('p3')),
        quad(ex('p1'), ex('kid'), ex('c1')), quad(ex('p1'), ex('kid'), ex('c2')), quad(ex('p3'), ex('kid'), ex('c3')),
        quad(ex('c1'), ex('age'), literal('1')), quad(ex('c1'), ex('age'), literal('2')),
        quad(ex('c2'), ex('age'), literal('3')), quad(ex('c3'), ex('age'), literal('4')),
      ]);
      const [x, p, c, a] = ['x', 'p', 'c', 'a'].map(name => variable(name));
      const iterator = matchBGP(branching, [quad(x, ex('parent'), p), quad(p, ex('kid'), c), quad(c, ex('age'), a)]);
      // Read solutions one at a time, so each read resumes the join after a yield
      function read() {
        const { value, done } = iterator.next();
        return done ? null : Object.fromEntries([...value].map(([key, term]) => [key.value, term.value]));
      }
      const r = 'http://example.org/r', p1 = 'http://example.org/p1', p3 = 'http://example.org/p3';
      const c1 = 'http://example.org/c1', c2 = 'http://example.org/c2', c3 = 'http://example.org/c3';
      assert.deepEqual(read(), { x: r, p: p1, c: c1, a: '1' });
      assert.deepEqual(read(), { x: r, p: p1, c: c1, a: '2' });
      assert.deepEqual(read(), { x: r, p: p1, c: c2, a: '3' });
      assert.deepEqual(read(), { x: r, p: p3, c: c3, a: '4' });
      assert.equal(read(), null);
    });

    it('should match many patterns without exhausting the call stack', () => {
      const ground = quad(ex('alice'), ex('knows'), ex('bob'));
      assert.deepEqual(solutions(new Array(20000).fill(ground)), [{}]);
      const quads = [], patterns = [];
      for (let i = 0; i < 5000; i++) {
        quads.push(quad(ex(`n${i}`), ex('next'), ex(`n${i + 1}`)));
        patterns.push(quad(i ? variable(`v${i}`) : ex('n0'), ex('next'), variable(`v${i + 1}`)));
      }
      const [bindings, ...rest] = matchBGP(create(quads), patterns);
      assert.equal(rest.length, 0);
      assert.equal(bindings.size, 5000);
      assert.ok(bindings.get('v5000').equals(ex('n5000')));
    });

    it('should yield RDF/JS Bindings from variables to terms', () => {
      const [bindings] = matchBGP(dataset, [quad(s, ex('name'), literal('Alice'))]);
      assert.ok(bindings instanceof Bindings);
      assert.equal(bindings.type, 'bindings');
      assert.ok(bindings.get('s').equals(ex('alice')));
      assert.ok(bindings.get(s).equals(ex('alice')));
      assert.deepEqual([...bindings.keys()].map(key => key.equals(s)), [true]);
    });

    it('should create solutions with a given bindings factory', () => {
      const created = [];
      const bindingsFactory = { bindings: entries => (created.push(entries), entries) };
      const results = [...matchBGP(dataset, [quad(s, ex('knows'), o)], { bindingsFactory })];
      assert.equal(results.length, 3);
      assert.deepEqual(results[0].map(([key]) => key.value).sort(), ['o', 's']);
      assert.deepEqual(created, results);
    });

    it('should match a single pattern in the default graph', () => {
      assert.deepEqual(sorted(solutions([quad(s, ex('name'), o)])), [
        { s: 'http://example.org/alice', o: '"Alice"' },
        { s: 'http://example.org/bob', o: '"Bob"' },
      ]);
    });

    it('should join patterns on shared variables', () => {
      assert.deepEqual(solutions([
        quad(s, ex('knows'), o),
        quad(o, ex('name'), literal('Bob')),
      ]), [{ s: 'http://example.org/alice', o: 'http://example.org/bob' }]);
    });

    it('should require a repeated variable to bind the same term', () => {
      assert.deepEqual(solutions([quad(s, ex('knows'), s)]), [{ s: 'http://example.org/carol' }]);
    });

    it('should bind graph variables', () => {
      assert.deepEqual(sorted(solutions([quad(ex('bob'), ex('name'), o, g)])), [
        { o: '"Bob"', g: '' },
        { o: '"Bobby"', g: 'http://example.org/g1' },
      ]);
    });

    it('should treat null and undefined as wildcards', () => {
      assert.equal(solutions([{ subject: s, predicate: ex('knows'), object: null }]).length, 3);
      assert.equal(solutions([{ subject: s, predicate: ex('name') }]).length, 3);
    });

    it('should yield nothing when a pattern has no matches', () => {
      assert.deepEqual(solutions([quad(s, ex('knows'), o), quad(o, ex('age'), variable('age'))]), []);
      assert.deepEqual(solutions([quad(s, ex('unknown'), o, defaultGraph())]), []);
    });

    it('should match every combination of known terms', () => {
      assert.deepEqual(solutions([quad(s, variable('p'), literal('Alice'))]),
        [{ s: 'http://example.org/alice', p: 'http://example.org/name' }]);
      assert.deepEqual(solutions([quad(ex('alice'), variable('p'), ex('bob'))]), [{ p: 'http://example.org/knows' }]);
      assert.deepEqual(solutions([quad(ex('alice'), ex('knows'), ex('carol'))]), []);
      assert.deepEqual(solutions([quad(ex('alice'), ex('name'), ex('bob'))]), []);
      assert.deepEqual(solutions([quad(ex('alice'), ex('knows'), ex('bob'))]), [{}]);
      assert.deepEqual(solutions([quad(literal('Alice'), variable('p'), o)]), []);
      assert.deepEqual(solutions([quad(ex('alice'), ex('g1'), o)]), []);
      assert.equal(solutions([quad(s, variable('p'), o, g)]).length, 6);
      assert.equal(solutions([quad(s, variable('p'), ex('carol'))]).length, 2);
    });

    it('should yield nothing for a graph that is a term but not a graph', () => {
      assert.deepEqual(solutions([quad(s, ex('knows'), o, ex('alice'))]), []);
    });

    it('should match triple terms', () => {
      const triple = quad(ex('alice'), ex('knows'), ex('bob'));
      dataset.add(quad(ex('claim'), ex('about'), triple));
      assert.deepEqual(solutions([quad(variable('c'), ex('about'), variable('t'))]),
        [{ c: 'http://example.org/claim', t: id(triple) }]);
      assert.deepEqual(solutions([quad(variable('c'), ex('about'), triple)]), [{ c: 'http://example.org/claim' }]);
    });

    it('should accept any iterable of patterns', () => {
      assert.deepEqual(solutions(new Set([quad(s, ex('knows'), ex('bob'))])), [{ s: 'http://example.org/alice' }]);
    });

    it('should not change the patterns', () => {
      const patterns = [quad(s, ex('knows'), o), quad(o, ex('knows'), variable('x'))];
      const copies = patterns.map(p => [p.subject, p.predicate, p.object, p.graph]);
      assert.equal(solutions(patterns).length, 3);
      assert.deepEqual(patterns.map(p => [p.subject, p.predicate, p.object, p.graph]), copies);
    });
  });
}

describe('matchBGP on an N3.js Store', () => {
  it('should bind terms from a custom factory whose quads have other keys', () => {
    const factory = Object.assign({}, DataFactory, {
      quad: (s, p, o, g) => ({ s, p, o, g }),
      namedNode: value => `named:${value}`,
    });
    const custom = new Store(DATA, { factory });
    const results = [...matchBGP(custom, [quad(s, ex('knows'), s), quad(s, ex('knows'), o)])];
    assert.deepEqual(results.map(bindings => Object.fromEntries([...bindings].map(([key, term]) => [key.value, term]))), [
      { s: 'named:http://example.org/carol', o: 'named:http://example.org/carol' },
    ]);
  });

  it('should give the same solutions as matching through the dataset interface', () => {
    const store = new Store(), quads = [];
    let seed = 1;
    const random = n => (seed = (seed * 16807) % 2147483647) % n;
    for (let i = 0; i < 400; i++)
      quads.push(quad(ex(`n${random(20)}`), ex(`p${random(3)}`), ex(`n${random(20)}`), random(4) ? defaultGraph() : ex('g')));
    store.addQuads(quads);
    const generic = new ArrayDataset(store.getQuads());
    const terms = [variable('a'), variable('b'), variable('c'), ex('n1'), ex('p0'), ex('p1'), null];
    for (let round = 0; round < 50; round++) {
      const patterns = [];
      for (let i = 0, n = 1 + random(3); i < n; i++)
        patterns.push({ subject: terms[random(7)], predicate: terms[3 + random(4)], object: terms[random(7)],
          graph: [null, defaultGraph(), variable('g')][random(3)] });
      const serialize = results => results.map(b => JSON.stringify([...b].map(([k, t]) => [k.value, id(t)]).sort())).sort();
      assert.deepEqual(serialize([...matchBGP(store, patterns)]), serialize([...matchBGP(generic, patterns)]));
    }
  });
});

describe('Bindings', () => {
  const factory = new BindingsFactory();
  const bindings = factory.bindings([[s, ex('a')], [o, literal('b')]]);

  it('should create empty bindings', () => {
    assert.equal(factory.bindings().size, 0);
    assert.equal(factory.bindings(null).size, 0);
  });

  it('should read entries by variable or name', () => {
    assert.equal(bindings.size, 2);
    assert.ok(bindings.has('s') && bindings.has(s) && !bindings.has('x'));
    assert.ok(bindings.get(o).equals(literal('b')));
    assert.deepEqual([...bindings.keys()].map(key => key.value), ['s', 'o']);
    assert.deepEqual([...bindings.values()].map(term => term.value), ['http://example.org/a', 'b']);
    const seen = [];
    bindings.forEach((term, key) => seen.push([key.value, term.value]));
    assert.deepEqual(seen, [['s', 'http://example.org/a'], ['o', 'b']]);
  });

  it('should return new bindings when changed', () => {
    const changed = bindings.set('x', ex('x')).delete(s);
    assert.deepEqual([...changed.keys()].map(key => key.value), ['o', 'x']);
    assert.equal(bindings.size, 2);
    assert.deepEqual([...bindings.filter((term, key) => key.value === 's').keys()].map(key => key.value), ['s']);
    assert.ok(bindings.map(() => ex('z')).get('o').equals(ex('z')));
  });

  it('should compare and merge', () => {
    assert.ok(bindings.equals(factory.fromBindings(bindings)));
    assert.ok(!bindings.equals(bindings.set('s', ex('b'))));
    assert.ok(!bindings.equals(bindings.delete('s').set('x', ex('a'))));
    assert.ok(!bindings.equals(null));
    assert.equal(bindings.merge(factory.bindings([[s, ex('other')]])), undefined);
    assert.equal(bindings.merge(factory.bindings([[variable('x'), ex('x')]])).size, 3);
    const merged = bindings.mergeWith(() => ex('merged'), factory.bindings([[s, ex('other')], [variable('x'), ex('x')]]));
    assert.ok(merged.get('s').equals(ex('merged')));
    assert.ok(merged.get('x').equals(ex('x')));
  });
});

// Matches basic graph patterns against an N3.js Store, or any RDF/JS DatasetCore.
import { DataFactory as N3DataFactory } from 'n3';
import { Bindings, BindingsFactory } from './bindings.js';

export { Bindings, BindingsFactory };

const QUAD_POSITIONS = ['subject', 'predicate', 'object', 'graph'];

// ### `matchBGP` yields the solutions of a basic graph pattern.
// `patterns` is an iterable of quads whose terms may be Variables.
// Each solution is an RDF/JS Bindings object from variables to the terms they are bound to,
// created by `options.bindingsFactory` if given.
// Setting any field to `undefined` or `null` indicates a wildcard.
export function* matchBGP(dataset, patterns, options = {}) {
  const steps = planBGP(Array.from(patterns));
  if (isN3Store(dataset))
    yield* matchN3Store(dataset, steps, options);
  else
    yield* matchDataset(dataset, steps, options);
}

// ### `isN3Store` checks whether the dataset has the indexes of an N3.js Store,
// which allow joining on the store's internal ids instead of on terms
function isN3Store(dataset) {
  return !!dataset && typeof dataset._termToNumericId === 'function' &&
    typeof dataset._termFromId === 'function' && !!dataset._entities &&
    !!dataset._graphs && typeof dataset._graphs === 'object';
}

// ### `planBGP` orders patterns so each step has the most terms known from earlier steps.
// For every step, `terms` holds the constants, `bound` the variables to fill from earlier steps,
// `binds` the variables the step binds, and `checks` repeats of those within the same pattern,
// the last three as flat lists of position and variable name pairs.
function planBGP(patterns) {
  const steps = [], known = new Set();
  // The variable term for each variable name
  steps.variables = new Map();
  // Count the known terms of each pattern, and which patterns each variable occurs in
  const counts = [], occurrences = new Map();
  patterns.forEach((pattern, i) => {
    counts[i] = 0;
    for (const name of QUAD_POSITIONS) {
      const term = pattern[name];
      if (term && term.termType === 'Variable') {
        const indexes = occurrences.get(term.value);
        if (indexes) indexes.push(i);
        else occurrences.set(term.value, [i]);
      }
      else if (term)
        counts[i]++;
    }
  });
  const remaining = patterns.map((pattern, i) => i);
  while (remaining.length) {
    let best = 0;
    for (let i = 1; i < remaining.length; i++) {
      if (counts[remaining[i]] > counts[remaining[best]])
        best = i;
    }
    const pattern = patterns[remaining.splice(best, 1)[0]];
    const step = { terms: [null, null, null, null], bound: [], binds: [], checks: [] };
    const binding = new Set();
    QUAD_POSITIONS.forEach((name, position) => {
      const term = pattern[name];
      if (!term || term.termType !== 'Variable')
        step.terms[position] = term || null;
      else if (known.has(term.value))
        step.bound.push(position, term.value);
      else if (binding.has(term.value))
        step.checks.push(position, term.value);
      else {
        step.binds.push(position, term.value), binding.add(term.value);
        steps.variables.set(term.value, term);
      }
    });
    for (const name of binding) {
      known.add(name);
      for (const i of occurrences.get(name))
        counts[i]++;
    }
    steps.push(step);
  }
  return steps;
}

// ### `joinSteps` joins the steps by backtracking with an explicit stack of iterators,
// so large patterns do not exhaust the call stack.
// `read(keys)` iterates over the matches of one step as arrays of four values,
// and `same(a, b)` compares two values.
function* joinSteps(steps, read, same, solution) {
  const bindings = new Map(), iterators = new Array(steps.length);
  let index = 0;
  while (index >= 0) {
    if (index === steps.length) {
      yield solution(bindings);
      index--;
    }
    else {
      const { keys, bound, binds, checks } = steps[index];
      if (!iterators[index]) {
        for (let i = 0; i < bound.length; i += 2)
          keys[bound[i]] = bindings.get(bound[i + 1]);
        iterators[index] = read(keys);
      }
      const { value, done } = iterators[index].next();
      if (done) {
        // Each match overwrites this step's bindings; drop them once the step is exhausted
        for (let i = 0; i < binds.length; i += 2)
          bindings.delete(binds[i + 1]);
        iterators[index--] = null;
      }
      else {
        for (let i = 0; i < binds.length; i += 2)
          bindings.set(binds[i + 1], value[binds[i]]);
        let consistent = true;
        for (let i = 0; consistent && i < checks.length; i += 2)
          consistent = same(bindings.get(checks[i + 1]), value[checks[i]]);
        if (consistent)
          index++;
      }
    }
  }
}

// ### `createBindings` creates a solution from the bound terms
function createBindings(steps, solution, options, factory) {
  const { bindingsFactory } = options;
  if (!bindingsFactory)
    return new Bindings(solution, factory);
  // A custom factory receives the variables of the patterns
  const entries = [];
  for (const [name, term] of solution)
    entries.push([steps.variables.get(name), term]);
  return bindingsFactory.bindings(entries);
}

// ### `matchN3Store` joins on the internal ids of an N3.js Store
function* matchN3Store(store, steps, options) {
  // A constant the store has never seen matches nothing
  for (const step of steps) {
    step.keys = step.terms.slice();
    for (let i = 0; i < 4; i++) {
      if (step.keys[i] && !(step.keys[i] = store._termToNumericId(step.keys[i])))
        return;
    }
  }
  // Cache terms by id, since solutions often share them
  const terms = new Map(), factory = store._factory || N3DataFactory;
  yield* joinSteps(steps, keys => readIds(store, keys), (a, b) => a === b, bindings => {
    const solution = new Map();
    for (const [name, id] of bindings) {
      let term = terms.get(id);
      if (term === undefined)
        terms.set(id, term = store._termFromId(store._entities[id]));
      solution.set(name, term);
    }
    return createBindings(steps, solution, options, factory);
  });
}

// ### `readIds` yields the subject, predicate, object, and graph ids of matching quads.
// Zero or undefined ids are wildcards. The yielded array is reused between results.
function* readIds(store, [subjectId, predicateId, objectId, graphId]) {
  // Choose the index as the store's readQuads does
  let indexName, key0, key1, key2, positions;
  if (objectId && (subjectId || !predicateId))
    indexName = 'objects', key0 = objectId, key1 = subjectId, key2 = predicateId, positions = [2, 0, 1];
  else if (!subjectId && predicateId)
    indexName = 'predicates', key0 = predicateId, key1 = objectId, key2 = subjectId, positions = [1, 2, 0];
  else
    indexName = 'subjects', key0 = subjectId, key1 = predicateId, key2 = objectId, positions = [0, 1, 2];

  const graphs = store._graphs, ids = [0, 0, 0, 0];
  const graphKeys = graphId ? [graphId] : Object.keys(graphs);
  for (let g = 0; g < graphKeys.length; g++) {
    // Mutations can remove keys captured before an earlier yield
    const index0 = graphs[graphKeys[g]] && graphs[graphKeys[g]][indexName];
    if (!index0) continue;
    ids[3] = +graphKeys[g];
    const keys0 = key0 ? [key0] : Object.keys(index0);
    for (let i0 = 0; i0 < keys0.length; i0++) {
      const index1 = index0[keys0[i0]];
      if (!index1) continue;
      ids[positions[0]] = +keys0[i0];
      const keys1 = key1 ? [key1] : Object.keys(index1);
      for (let i1 = 0; i1 < keys1.length; i1++) {
        const index2 = index1[keys1[i1]];
        if (!index2) continue;
        ids[positions[1]] = +keys1[i1];
        if (key2) {
          if (key2 in index2) {
            ids[positions[2]] = key2;
            yield ids;
          }
        }
        else {
          const keys2 = Object.keys(index2);
          for (let i2 = 0; i2 < keys2.length; i2++) {
            ids[positions[2]] = +keys2[i2];
            yield ids;
          }
        }
      }
    }
  }
}

// ### `matchDataset` joins on terms through the `match` method of any RDF/JS DatasetCore
function* matchDataset(dataset, steps, options) {
  for (const step of steps)
    step.keys = step.terms.slice();
  const factory = options.dataFactory || N3DataFactory;
  yield* joinSteps(steps, keys => readQuads(dataset, keys), (a, b) => a.equals(b),
    bindings => createBindings(steps, new Map(bindings), options, factory));
}

// ### `readQuads` yields the subject, predicate, object, and graph of matching quads
function* readQuads(dataset, [subject, predicate, object, graph]) {
  for (const quad of dataset.match(subject, predicate, object, graph))
    yield [quad.subject, quad.predicate, quad.object, quad.graph];
}

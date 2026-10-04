import type * as RDF from '@rdfjs/types';

export interface QuadPattern {
  subject?: RDF.Term | null;
  predicate?: RDF.Term | null;
  object?: RDF.Term | null;
  graph?: RDF.Term | null;
}

export interface MatchBGPOptions<B = Bindings> {
  /** Creates the solutions; it receives the variables of the patterns as keys. */
  bindingsFactory?: { bindings(entries?: [RDF.Variable, RDF.Term][]): B };
  /** Creates variable keys when matching a dataset that is not an N3.js Store. */
  dataFactory?: Pick<RDF.DataFactory, 'variable'>;
}

/** Yields one solution for every way the patterns match the dataset together. */
export function matchBGP<B = Bindings>(
  dataset: RDF.DatasetCore,
  patterns: Iterable<QuadPattern>,
  options?: MatchBGPOptions<B>,
): Generator<B, void, undefined>;

export class Bindings implements RDF.Bindings {
  readonly type: 'bindings';
  readonly size: number;
  has(key: RDF.Variable | string): boolean;
  get(key: RDF.Variable | string): RDF.Term | undefined;
  set(key: RDF.Variable | string, value: RDF.Term): Bindings;
  delete(key: RDF.Variable | string): Bindings;
  keys(): Iterable<RDF.Variable>;
  values(): Iterable<RDF.Term>;
  forEach(fn: (value: RDF.Term, key: RDF.Variable) => any): void;
  [Symbol.iterator](): Iterator<[RDF.Variable, RDF.Term]>;
  equals(other: RDF.Bindings | null | undefined): boolean;
  filter(fn: (value: RDF.Term, key: RDF.Variable) => boolean): Bindings;
  map(fn: (value: RDF.Term, key: RDF.Variable) => RDF.Term): Bindings;
  merge(other: RDF.Bindings): Bindings | undefined;
  mergeWith(merger: (self: RDF.Term, other: RDF.Term, key: RDF.Variable) => RDF.Term, other: RDF.Bindings): Bindings;
}

export class BindingsFactory implements RDF.BindingsFactory {
  constructor(dataFactory?: Pick<RDF.DataFactory, 'variable'>);
  bindings(entries?: [RDF.Variable, RDF.Term][] | null): Bindings;
  fromBindings(bindings: RDF.Bindings): Bindings;
}

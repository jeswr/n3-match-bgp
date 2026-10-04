# n3-match-bgp

Matches [basic graph patterns](https://www.w3.org/TR/sparql11-query/#BasicGraphPatterns) against an [N3.js](https://github.com/rdfjs/N3.js) `Store`, or any [RDF/JS `DatasetCore`](https://rdf.js.org/dataset-spec/#datasetcore-interface), and yields one [RDF/JS `Bindings`](https://rdf.js.org/query-spec/#bindings-interface) object per solution.

> **Status:** this is being worked on as a consideration for the [RDF/JS specifications](https://rdf.js.org/). It will only land on N3.js main if it lands in that spec.

## Installation

```sh
npm install n3-match-bgp n3
```

`n3` is a peer dependency. The package is an ES module and needs Node.js 18 or later.

## Usage

```js
import { Store, DataFactory } from 'n3';
import { matchBGP } from 'n3-match-bgp';

const { namedNode, literal, variable, quad } = DataFactory;
const knows = namedNode('http://xmlns.com/foaf/0.1/knows');
const name = namedNode('http://xmlns.com/foaf/0.1/name');

const store = new Store([
  quad(namedNode('http://example.org/alice'), knows, namedNode('http://example.org/bob')),
  quad(namedNode('http://example.org/bob'), name, literal('Bob')),
]);

const [person, friend, friendName] = [variable('person'), variable('friend'), variable('friendName')];
for (const bindings of matchBGP(store, [
  quad(person, knows, friend),
  quad(friend, name, friendName),
]))
  console.log(bindings.get('person').value, 'knows', bindings.get('friendName').value);
```

`matchBGP(dataset, patterns, options)` takes an iterable of quad patterns whose terms may be variables. It returns a generator with one solution for every way the patterns match the dataset together.

- A variable that occurs in several patterns, or several times in one pattern, must bind the same term everywhere.
- `null` or `undefined` in a pattern is a wildcard that binds nothing.
- A pattern created with `quad(s, p, o)` gets the default graph from the factory, so it matches the default graph only. A plain-object pattern without a `graph` treats it as a wildcard and also matches named graphs. Use a variable as the graph to match and bind the graph of quads in any graph.
- Patterns are joined in order of how many of their terms are known, and the join backtracks with an explicit stack, so long patterns do not exhaust the call stack.

### Options

- `bindingsFactory`: an RDF/JS `BindingsFactory`, such as Comunica's, to create the solutions with. It receives the variables of the patterns as keys.
- `dataFactory`: the factory used to create variable keys when matching a dataset that is not an N3.js `Store`. The default is N3.js's `DataFactory`.

### Bindings

The package also exports its own immutable `Bindings` and `BindingsFactory`. `get` and `has` accept a variable or its name.

```js
import { BindingsFactory } from 'n3-match-bgp';

const bindings = new BindingsFactory().bindings([[variable('s'), namedNode('http://example.org/alice')]]);
bindings.get('s'); // NamedNode http://example.org/alice
```

## How it works

On an N3.js `Store`, the join runs on the store's internal numeric ids and indexes, and terms are only created for the solutions. This relies on internal fields of the `Store` from N3.js 2.x, which are not part of its public API. Any other dataset is matched through its `match` method, comparing terms with `equals`.

## License

MIT

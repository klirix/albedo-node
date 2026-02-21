# albedo-node

Native Node.js/Bun bindings for the [Albedo](https://github.com/klirix/albedo) embedded document database.

This package wraps the core database engine with a concise TypeScript API, ships prebuilt binaries for common platforms, and exposes BSON helpers plus replication utilities so you can embed Albedo buckets directly in your applications.

## Features

- 🧱 Access to the full Albedo bucket API from Node.js or Bun
- 📦 Precompiled native modules for Linux (glibc & musl), macOS, and arm64/x64
- 🔁 Generator-based iterators for queries and in-place document transforms
- 🔄 Built-in replication callback and apply mechanisms
- 🧪 TypeScript typings and Bun-based test suite

## Installation

Install with your preferred package manager (Node.js 18+ or Bun 1.0+ recommended):

```bash
npm install albedo-node
```

```bash
pnpm add albedo-node
```

```bash
bun add albedo-node
```

The published package includes native binaries under `native/`. When running on an unsupported platform, or if you prefer to build locally, install [Zig 0.15.x](https://ziglang.org/download/) and run `bun run build` to compile the binding.

## Quick start

```ts
import albedo, { BSON, Bucket, where } from "albedo-node";

// Open or create a bucket on disk
const bucket = Bucket.open("./example.bucket");

// Insert JavaScript objects or pre-serialized BSON buffers
bucket.insert({ name: "Ada", skills: ["math", "computing"] });

const serialized = BSON.serialize({ name: "Alan", skills: ["logic", "cryptanalysis"] });
bucket.insert(serialized);

// List documents using a generator with the fluent `where` helper
for (const doc of bucket.list(where("name", { $eq: "Ada" }))) {
  console.log(doc);
}

bucket.close();
```

### Fluent query helpers

Use the fluent `Query` builder when you need more than a single-field filter:

```ts
import { Bucket, Query } from "albedo-node";

const bucket = Bucket.open("./example.bucket");

const adults = new Query()
  .where("age", { $gte: 21 })
  .sortBy("_id", "asc")
  .sector(0, 50);

for (const doc of bucket.list(adults)) {
  console.log(doc);
}

bucket.close();
```

You can chain multiple `where` calls or combine them with `sortBy` and `sector`. For quick one-off predicates, the standalone `where(field, filter)` helper returns a `Query` instance that slots into any method accepting a query.

### Transforming documents in place

```ts
const iter = bucket.transformIterator({ query: { name: "Ada" } });
let step = iter.next();
while (!step.done) {
  const doc = step.value as { name: string; skills: string[] };
  step = iter.next({ ...doc, skills: [...doc.skills, "analytics"] });
}
```

### Replication

```ts
const primary = Bucket.open("./primary.bucket");
const replica = Bucket.open("./replica.bucket");

const batches: Uint8Array[] = [];
primary.setReplicationCallback((data) => {
  batches.push(data);
});

primary.insert({ name: "Replica", version: 1 });
primary.close();

// Apply the first batch to the replica bucket
if (batches.length > 0) {
  replica.applyReplicationBatch(batches[0]);
}

replica.close();
```

## Query objects and BSON payloads

Most bucket operations accept either:

- Plain JavaScript objects that will be converted to BSON automatically, or
- Raw `Uint8Array` buffers containing BSON documents that you have serialized yourself, or
- Instances of the fluent `Query` builder (including values produced by the `where()` helper).

Regardless of which form you use, the structure mirrors the underlying Albedo query language. Common patterns include:

- `{ query: { field: value } }` — equality filters
- `{ query: { age: { "$gt": 40 } } }` — comparison operators
- `{ query: { _id: someId }, sector: { limit: 10, offset: 0 } }` — pagination controls

For the exhaustive list of operators and document shapes, consult the [Albedo Query reference](https://github.com/klirix/albedo#readme). Whatever BSON document the core engine accepts can be provided here either as a plain object or as prebuilt BSON bytes.

### ObjectId support

The module exposes `albedo.ObjectId`, compatible with the BSON 12-byte identifier:

```ts
const id = new albedo.ObjectId();
const hex = id.toString();
const parsed = albedo.ObjectId.fromString(hex);
```

Serialized documents that contain `_id` fields with a BSON ObjectId will be revived as `ObjectId` instances when deserialized.

## API reference

- `default` export — raw Albedo native module
  - `ObjectId`, `serialize`, `deserialize`, `open`, `close`, `insert`, `delete`, `list`, `transform`, `setReplicationCallback`, etc.
- `BSON.serialize(value)` / `BSON.deserialize(bytes)` — helper wrappers
- `Bucket`
  - `static open(path: string): Bucket`
  - `insert(doc: object | Uint8Array)`
  - `delete(query?: object | Query)`
  - `list<T>(query?: object | Query): Generator<T>`
  - `transformIterator<T>(query?: object | Query): Generator<T, undefined, object | null>`
  - `ensureIndex(name: string, options: { unique: boolean; sparse: boolean; reverse: boolean })`
  - `dropIndex(name: string)`
  - `indexes: Record<string, { name: string; unique: boolean; sparse: boolean; reverse: boolean }>`
  - `setReplicationCallback(cb: (data: Uint8Array) => void)`
  - `applyReplicationBatch(batch: Uint8Array)`
  - accepts raw BSON `Uint8Array` payloads anywhere a query or document object is expected

- `Query`
  - `where(field, filter)` chains field predicates (e.g. `{ $eq: value }`, `{ $gt: 10 }`)
  - `sortBy(field, direction?)` sets sort order
  - `sector(offset?, limit?)` applies pagination window

- `where(field, filter): Query` — convenience helper that creates a single-field `Query`

## Building from source

```bash
bun install
bun run build # zig build + tsc emit
```

The build step compiles the Zig binding for the current host and writes the `.node` artifact into `native/`, then emits the TypeScript declaration files to `dist/`.

## Running tests

```bash
bun test
```

The test suite exercises insertion, querying, indexing, transforms, replication, and BSON round-trips using Bun’s test runner.

## License

MIT. See the accompanying `LICENSE` file (or the upstream [Albedo](https://github.com/klirix/albedo) repository) for details.

type ByteBuffer = Uint8Array;

type BucketHandle = object;
type ListIteratorHandle = object;
type TransformIteratorHandle = object;

interface IndexOptions {
  unique: boolean;
  sparse: boolean;
  reverse: boolean;
}

interface IndexInfo {
  name: string;
  unique: boolean;
  sparse: boolean;
  reverse: boolean;
}

interface ObjectIdInstance {
  buffer: ByteBuffer;
  toString(): string;
}

interface ObjectIdConstructor {
  new (buffer?: ByteBuffer): ObjectIdInstance;
  fromString(hex: string): ObjectIdInstance;
}

interface AlbedoModule {
  ObjectId: ObjectIdConstructor;
  serialize(value: unknown): Uint8Array;
  deserialize<T = unknown>(data: ByteBuffer): T;
  open(path: string): BucketHandle;
  close(bucket: BucketHandle): void;
  list(bucket: BucketHandle, query: ByteBuffer): ListIteratorHandle;
  listClose(cursor: ListIteratorHandle): void;
  listData(cursor: ListIteratorHandle): Uint8Array | null;
  insert(bucket: BucketHandle, doc: ByteBuffer): void;
  ensureIndex(bucket: BucketHandle, name: string, options: IndexOptions): void;
  listIndexes(bucket: BucketHandle): Record<string, IndexInfo>;
  dropIndex(bucket: BucketHandle, name: string): void;
  delete(bucket: BucketHandle, query: ByteBuffer): void;
  transform(bucket: BucketHandle, query: ByteBuffer): TransformIteratorHandle;
  transformClose(iter: TransformIteratorHandle): void;
  transformData(iter: TransformIteratorHandle): Uint8Array | null;
  transformApply(
    iter: TransformIteratorHandle,
    replace: ByteBuffer | null,
  ): void;
  setReplicationCallback(
    bucket: BucketHandle,
    callback: (data: Uint8Array) => void,
  ): void;
  applyReplicationBatch(bucket: BucketHandle, data: ByteBuffer): void;
}

const platformSuffix = process.platform;
const archSuffix = process.arch === "x64" ? "x86_64" : process.arch;

const albedo = require(
  `../native/albedo.${archSuffix}_${platformSuffix}.node`,
) as AlbedoModule;

export default albedo;

export class Bucket {
  private handle: BucketHandle;

  constructor(handle: object) {
    this.handle = handle as BucketHandle;
  }

  static open(path: string): Bucket {
    const handle = albedo.open(path);
    return new Bucket(handle);
  }

  close(): void {
    albedo.close(this.handle);
  }

  insert(doc: unknown): void {
    const data = albedo.serialize(doc);
    albedo.insert(this.handle, data);
  }

  get indexes() {
    return albedo.listIndexes(this.handle);
  }

  ensureIndex(name: string, options: IndexOptions): void {
    albedo.ensureIndex(this.handle, name, options);
  }

  dropIndex(name: string): void {
    albedo.dropIndex(this.handle, name);
  }

  *list<T>(query: unknown): Generator<T> {
    const queryData = albedo.serialize(query);
    const cursor = albedo.list(this.handle, queryData);
    try {
      let data: Uint8Array | null;
      while ((data = albedo.listData(cursor)) !== null) {
        yield albedo.deserialize<T>(data);
      }
    } finally {
      albedo.listClose(cursor);
    }
  }

  *transformIterator<T>(
    query: unknown,
  ): Generator<T, undefined, null | object> {
    const queryData = albedo.serialize(query);
    const iter = albedo.transform(this.handle, queryData);
    try {
      let data: Uint8Array | null;
      while ((data = albedo.transformData(iter)) !== null) {
        const newDoc = yield albedo.deserialize<T>(data);
        albedo.transformApply(
          iter,
          newDoc !== null ? albedo.serialize(newDoc) : null,
        );
      }
    } finally {
      albedo.transformClose(iter);
    }
  }

  setReplicationCallback(callback: (data: Uint8Array) => void): void {
    albedo.setReplicationCallback(this.handle, callback);
  }

  applyReplicationBatch(data: Uint8Array): void {
    albedo.applyReplicationBatch(this.handle, data);
  }
}

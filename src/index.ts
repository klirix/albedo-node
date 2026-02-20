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
  list(bucket: BucketHandle, query: object): ListIteratorHandle;
  listClose(cursor: ListIteratorHandle): void;
  listData(cursor: ListIteratorHandle): unknown | null;
  insert(bucket: BucketHandle, doc: ByteBuffer | object): void;
  ensureIndex(bucket: BucketHandle, name: string, options: IndexOptions): void;
  listIndexes(bucket: BucketHandle): Record<string, IndexInfo>;
  dropIndex(bucket: BucketHandle, name: string): void;
  delete(bucket: BucketHandle, query: object): void;
  transform(bucket: BucketHandle, query: object): TransformIteratorHandle;
  transformClose(iter: TransformIteratorHandle): void;
  transformData(iter: TransformIteratorHandle): unknown | null;
  transformApply(
    iter: TransformIteratorHandle,
    replace: ByteBuffer | object | null,
  ): void;
  setReplicationCallback(
    bucket: BucketHandle,
    callback: (data: Uint8Array) => void,
  ): void;
  applyReplicationBatch(bucket: BucketHandle, data: ByteBuffer): void;
}

const platformSuffix = process.platform == "darwin" ? "macos" : process.platform === "win32" ? "windows" : process.platform;
const archSuffix = process.arch === "x64" ? "x86_64" : process.arch === "arm64" ? "aarch64" : process.arch;
const isMusl = process.versions.libc && process.versions.libc.includes("musl");
const libcSuffix = isMusl ? "_musl" : "";

const albedo = require(
  `../native/albedo.${archSuffix}_${platformSuffix}${libcSuffix}.node`,
) as AlbedoModule;

export default albedo;

export const BSON = {
  serialize: albedo.serialize,
  deserialize: albedo.deserialize,
};

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

  insert(doc: object | ByteBuffer): void {
    albedo.insert(this.handle, doc);
  }

  delete(query: object): void {
    albedo.delete(this.handle, query);
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

  *list<T>(query: object): Generator<T> {
    const cursor = albedo.list(this.handle, query);
    try {
      let data: unknown | null;
      while ((data = albedo.listData(cursor)) !== null) {
        yield data as T;
      }
    } finally {
      albedo.listClose(cursor);
    }
  }

  *transformIterator<T>(
    query: object
  ): Generator<T, undefined, null | object> {
    const iter = albedo.transform(this.handle, query);
    try {
      let data: unknown | null;
      while ((data = albedo.transformData(iter)) !== null) {
        const newDoc = yield data as T;
        albedo.transformApply(iter, newDoc);
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

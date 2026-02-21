import Bun from 'bun';
import {describe, test, expect} from 'bun:test';
import albedo, {BSON, Bucket, where} from './index';

describe('Albedo — major functionality', () => {
    test('insert & list (objects)', async () => {
        const db = 'test.db';
        const bucket = Bucket.open(db);
        bucket.insert({name: 'Alice', age: 30});
        bucket.insert({name: 'Bob', age: 25});

        const results = Array.from(bucket.list({}));
        expect(results).toEqual([
            {name: 'Alice', age: 30, _id: expect.anything()},
            {name: 'Bob', age: 25, _id: expect.anything()},
        ]);

        bucket.close();
        await Bun.file(db).delete();
    });

    test('ObjectId and BSON serialize/deserialize roundtrip', () => {
        const id = new albedo.ObjectId();
        const hex = id.toString();
        expect(typeof hex).toBe('string');
        expect(hex).toHaveLength(24);

        const parsed = albedo.ObjectId.fromString(hex);
        expect(parsed.toString()).toBe(hex);

        const doc = { _id: id, name: 'Charlie', nested: { n: 1 } };
        const bytes = BSON.serialize(doc);
        const got = BSON.deserialize(bytes) as any;

        expect(got.name).toBe('Charlie');
        expect(got._id).toBeDefined();
        expect(got._id.toString()).toBe(hex);
        expect(got.nested).toEqual({ n: 1 });
    });

    test('ensureIndex, listIndexes and dropIndex', async () => {
        const db = 'test-indexes.db';
        const bucket = Bucket.open(db);
        bucket.insert({name: 'Alice', age: 30});
        bucket.insert({name: 'Bob', age: 25});

        bucket.ensureIndex('name', { unique: false, sparse: false, reverse: false });
        const idx = bucket.indexes;
        expect(idx).toHaveProperty('name');
        expect(idx.name).toMatchObject({ name: 'name', unique: false, sparse: false, reverse: false });

        bucket.dropIndex('name');
        const after = bucket.indexes;
        expect(after.name).toBeUndefined();

        bucket.close();
        await Bun.file(db).delete();
    });

    test('transformIterator can modify documents in-place', async () => {
        const db = 'test-transform.db';
        const bucket = Bucket.open(db);
        bucket.insert({name: 'Alice', age: 30});
        bucket.insert({name: 'Bob', age: 25});

        const it = bucket.transformIterator({});
        let res = it.next();
        while (!res.done && res.value) {
            const doc: any = res.value;
            if (doc.name === 'Bob') {
                // increment Bob's age
                res = it.next({ ...doc, age: doc.age + 1 });
            } else {
                // leave Alice unchanged
                res = it.next(doc);
            }
        }

        const results = Array.from(bucket.list({}));
        // Bob's age should have been incremented
        expect(results).toEqual(
            expect.arrayContaining([
                { name: 'Alice', age: 30, _id: expect.anything() },
                { name: 'Bob', age: 26, _id: expect.anything() },
            ]),
        );

        bucket.close();
        await Bun.file(db).delete();
    });

    test('Bucket.delete removes matching documents', async () => {
        const db = 'test-delete.db';
        const bucket = Bucket.open(db);
        bucket.insert({ name: 'Alice' });
        bucket.insert({ name: 'Bob' });

        // delete Alice
        bucket.delete(where('name', { $eq: 'Alice' }));

        const results = Array.from(bucket.list({}));
        expect(results).toEqual([{ name: 'Bob', _id: expect.anything() }]);

        bucket.close();
        await Bun.file(db).delete();
    });

    test('Bucket.transform helper modifies and deletes documents', async () => {
        const db = 'test-transform-helper.db';
        const bucket = Bucket.open(db);
        bucket.insert({ name: 'A', count: 1 });
        bucket.insert({ name: 'B', count: 5 });
        bucket.insert({ name: 'C', count: 10 });

        // increment counts under 6, delete count >= 10
        bucket.transform({}, (doc: any) => {
            if (doc.count >= 10) return null;
            return { ...doc, count: doc.count + 1 };
        });


        const results = Array.from(bucket.list({}));
        expect(results).toEqual(
            expect.arrayContaining([
                { name: 'A', count: 2, _id: expect.anything() },
                { name: 'B', count: 6, _id: expect.anything() },
            ]),
        );
        // C should be gone
        expect(results.find(r => (r as any).name === 'C')).toBeUndefined();

        bucket.close();
        await Bun.file(db).delete();
    });

    test('Bucket.transform can be used with query builder', async () => {
        const db = 'test-transform-builder.db';
        const bucket = Bucket.open(db);
        bucket.insert({ kind: 'x', val: 2 });
        bucket.insert({ kind: 'y', val: 3 });


        bucket.transform(where('kind', { $eq: 'x' }), (d: any) => ({ ...d, val: d.val * 10 }));

        const results = Array.from(bucket.list({}));
        expect(results).toEqual(
            expect.arrayContaining([
                { kind: 'x', val: 20, _id: expect.anything() },
                { kind: 'y', val: 3, _id: expect.anything() },
            ]),
        );

        bucket.close();
        await Bun.file(db).delete();
    });

    test('Bucket.insert accepts a serialized BSON buffer', async () => {
        const db = 'test-buffer.db';
        const bucket = Bucket.open(db);
        const bytes = BSON.serialize({ name: 'BufferBob', value: 10 });
        bucket.insert(bytes);

        const results = Array.from(bucket.list({}));
        expect(results).toEqual([{ name: 'BufferBob', value: 10, _id: expect.anything() }]);

        bucket.close();
        await Bun.file(db).delete();
    });

    test('replication: capture batch from one bucket and apply to another', async () => {
        const aDb = 'test-replica-a.db';
        const bDb = 'test-replica-b.db';
        const a = Bucket.open(aDb);
        const b = Bucket.open(bDb);

        const batches: Uint8Array[] = [];
        const replicated = new Promise(resolve => {
            a.setReplicationCallback((data) => {
              batches.push(data);
                resolve(null);
            });
        })

        a.insert({ name: 'Replicated', value: 1 });
        a.close();

        await replicated;

        expect(batches.length).toBeGreaterThan(0);

        // apply first batch to the second bucket
        b.applyReplicationBatch(batches[0]);

        const results = Array.from(b.list({}));
        expect(results).toEqual([{ name: 'Replicated', value: 1, _id: expect.anything() }]);

        
        b.close();
        await Bun.file(aDb).delete();
        await Bun.file(bDb).delete();
    }, 10_000);
});
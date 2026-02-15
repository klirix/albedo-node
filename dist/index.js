"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Bucket = void 0;
const platformSuffix = process.platform;
const archSuffix = process.arch === "x64" ? "x86_64" : process.arch;
const albedo = require(`../native/albedo.${archSuffix}_${platformSuffix}.node`);
exports.default = albedo;
class Bucket {
    handle;
    constructor(handle) {
        this.handle = handle;
    }
    static open(path) {
        const handle = albedo.open(path);
        return new Bucket(handle);
    }
    close() {
        albedo.close(this.handle);
    }
    insert(doc) {
        const data = albedo.serialize(doc);
        albedo.insert(this.handle, data);
    }
    get indexes() {
        return albedo.listIndexes(this.handle);
    }
    ensureIndex(name, options) {
        albedo.ensureIndex(this.handle, name, options);
    }
    dropIndex(name) {
        albedo.dropIndex(this.handle, name);
    }
    *list(query) {
        const queryData = albedo.serialize(query);
        const cursor = albedo.list(this.handle, queryData);
        try {
            let data;
            while ((data = albedo.listData(cursor)) !== null) {
                yield albedo.deserialize(data);
            }
        }
        finally {
            albedo.listClose(cursor);
        }
    }
    *transformIterator(query) {
        const queryData = albedo.serialize(query);
        const iter = albedo.transform(this.handle, queryData);
        try {
            let data;
            while ((data = albedo.transformData(iter)) !== null) {
                const newDoc = yield albedo.deserialize(data);
                albedo.transformApply(iter, newDoc !== null ? albedo.serialize(newDoc) : null);
            }
        }
        finally {
            albedo.transformClose(iter);
        }
    }
    setReplicationCallback(callback) {
        albedo.setReplicationCallback(this.handle, callback);
    }
    applyReplicationBatch(data) {
        albedo.applyReplicationBatch(this.handle, data);
    }
}
exports.Bucket = Bucket;

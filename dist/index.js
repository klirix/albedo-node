"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Bucket = exports.BSON = void 0;
const platformSuffix = process.platform == "darwin" ? "macos" : process.platform === "win32" ? "windows" : process.platform;
const archSuffix = process.arch === "x64" ? "x86_64" : process.arch === "arm64" ? "aarch64" : process.arch;
const isMusl = process.versions.libc && process.versions.libc.includes("musl");
const libcSuffix = isMusl ? "_musl" : "";
const albedo = require(`../native/albedo.${archSuffix}_${platformSuffix}${libcSuffix}.node`);
exports.default = albedo;
exports.BSON = {
    serialize: albedo.serialize,
    deserialize: albedo.deserialize,
};
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
        albedo.insert(this.handle, doc);
    }
    delete(query) {
        albedo.delete(this.handle, query);
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
        const cursor = albedo.list(this.handle, query);
        try {
            let data;
            while ((data = albedo.listData(cursor)) !== null) {
                yield data;
            }
        }
        finally {
            albedo.listClose(cursor);
        }
    }
    *transformIterator(query) {
        const iter = albedo.transform(this.handle, query);
        try {
            let data;
            while ((data = albedo.transformData(iter)) !== null) {
                const newDoc = yield data;
                albedo.transformApply(iter, newDoc);
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

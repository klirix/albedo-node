//! By convention, root.zig is the root source file when making a library.
const std = @import("std");
const albedo = @import("albedo");
const napigen = @import("napigen");
const bson = @import("./bson.zig");

const ally = std.heap.smp_allocator;

fn runtimeIo() std.Io {
    return std.Io.Threaded.global_single_threaded.io();
}

const ReplicationCursorPayload = struct {
    generation: u64,
    next_frame_index: u64,
};

fn unixTimestamp() u32 {
    var ts: std.posix.timespec = undefined;
    switch (std.posix.errno(std.posix.system.clock_gettime(.REALTIME, &ts))) {
        .SUCCESS => {
            if (ts.sec <= 0) return 0;
            if (ts.sec > std.math.maxInt(u32)) return std.math.maxInt(u32);
            return @intCast(ts.sec);
        },
        else => return 0,
    }
}

fn generateObjectIdBytes() [12]u8 {
    var raw: [12]u8 = undefined;
    std.mem.writeInt(u32, raw[0..4], unixTimestamp(), .big);
    runtimeIo().random(raw[4..12]);

    return raw;
}

fn objectIdConstructorFunction(env: napigen.napi.napi_env, info: napigen.napi.napi_callback_info) callconv(.c) napigen.napi_value {
    var argc: usize = 1;
    var argv: [1]napigen.napi_value = .{null};
    var this_arg: napigen.napi_value = null;
    const status = napigen.napi.napi_get_cb_info(env, info, &argc, &argv[0], &this_arg, null);
    if (status != napigen.napi.napi_ok) return null;

    if (argc >= 1 and argv[0] != null) {
        _ = napigen.napi.napi_set_named_property(env, this_arg, "buffer", argv[0]);
        return this_arg;
    }

    const raw = generateObjectIdBytes();

    var arraybuffer: napigen.napi.napi_value = undefined;
    var data_ptr: ?*anyopaque = null;
    if (napigen.napi.napi_create_arraybuffer(env, raw.len, &data_ptr, &arraybuffer) != napigen.napi.napi_ok) return null;
    if (data_ptr == null) return null;

    const dst = @as([*]u8, @ptrCast(data_ptr.?));
    @memcpy(dst[0..raw.len], raw[0..]);

    var typedarray: napigen.napi.napi_value = undefined;
    if (napigen.napi.napi_create_typedarray(env, napigen.napi.napi_uint8_array, raw.len, arraybuffer, 0, &typedarray) != napigen.napi.napi_ok) return null;
    _ = napigen.napi.napi_set_named_property(env, this_arg, "buffer", typedarray);

    return this_arg;
}

fn objectIdToStringFunction(env: napigen.napi.napi_env, info: napigen.napi.napi_callback_info) callconv(.c) napigen.napi_value {
    var argc: usize = 0;
    var this_arg: napigen.napi.napi_value = null;
    if (napigen.napi.napi_get_cb_info(env, info, &argc, null, &this_arg, null) != napigen.napi.napi_ok) return null;

    var buffer_value: napigen.napi.napi_value = undefined;
    if (napigen.napi.napi_get_named_property(env, this_arg, "buffer", &buffer_value) != napigen.napi.napi_ok) return null;

    var raw: [12]u8 = undefined;

    var is_buffer: bool = false;
    if (napigen.napi.napi_is_buffer(env, buffer_value, &is_buffer) != napigen.napi.napi_ok) return null;
    if (is_buffer) {
        var data_ptr: ?*anyopaque = null;
        var length: usize = 0;
        if (napigen.napi.napi_get_buffer_info(env, buffer_value, &data_ptr, &length) != napigen.napi.napi_ok) return null;
        if (data_ptr == null or length != 12) return null;
        const src = @as([*]const u8, @ptrCast(data_ptr.?));
        @memcpy(raw[0..12], src[0..12]);
    } else {
        var typed_array_type: napigen.napi.napi_typedarray_type = undefined;
        var length: usize = 0;
        var data_ptr: ?*anyopaque = null;
        if (napigen.napi.napi_get_typedarray_info(env, buffer_value, &typed_array_type, &length, &data_ptr, null, null) != napigen.napi.napi_ok) return null;
        if (data_ptr == null or length != 12) return null;
        if (typed_array_type != napigen.napi.napi_uint8_array and typed_array_type != napigen.napi.napi_uint8_clamped_array) return null;
        const src = @as([*]const u8, @ptrCast(data_ptr.?));
        @memcpy(raw[0..12], src[0..12]);
    }

    const hex = albedo.bson.ObjectId.toString(.{ .buffer = raw });
    var result: napigen.napi.napi_value = undefined;
    if (napigen.napi.napi_create_string_utf8(env, &hex[0], hex.len, &result) != napigen.napi.napi_ok) return null;
    return result;
}

fn objectIdFromStringFunction(env: napigen.napi.napi_env, info: napigen.napi.napi_callback_info) callconv(.c) napigen.napi_value {
    var argc: usize = 1;
    var argv: [1]napigen.napi.napi_value = .{null};
    var this_arg: napigen.napi.napi_value = null;
    if (napigen.napi.napi_get_cb_info(env, info, &argc, &argv[0], &this_arg, null) != napigen.napi.napi_ok) return null;
    if (argc < 1 or argv[0] == null) return null;

    var str_len: usize = 0;
    if (napigen.napi.napi_get_value_string_utf8(env, argv[0], null, 0, &str_len) != napigen.napi.napi_ok) return null;

    var str_buf: [25]u8 = undefined;
    if (str_len != 24) return null;
    var written: usize = 0;
    if (napigen.napi.napi_get_value_string_utf8(env, argv[0], &str_buf[0], str_buf.len, &written) != napigen.napi.napi_ok) return null;

    const parsed = albedo.bson.ObjectId.parseString(str_buf[0..written]) catch return null;

    var arraybuffer: napigen.napi.napi_value = undefined;
    var data_ptr: ?*anyopaque = null;
    if (napigen.napi.napi_create_arraybuffer(env, 12, &data_ptr, &arraybuffer) != napigen.napi.napi_ok) return null;
    if (data_ptr == null) return null;

    const dst = @as([*]u8, @ptrCast(data_ptr.?));
    @memcpy(dst[0..12], parsed.buffer[0..12]);

    var typedarray: napigen.napi.napi_value = undefined;
    if (napigen.napi.napi_create_typedarray(env, napigen.napi.napi_uint8_array, 12, arraybuffer, 0, &typedarray) != napigen.napi.napi_ok) return null;

    var instance: napigen.napi.napi_value = undefined;
    if (napigen.napi.napi_new_instance(env, this_arg, 1, &typedarray, &instance) != napigen.napi.napi_ok) return null;
    return instance;
}

comptime {
    napigen.defineModule(initModule);
}

fn open(path: []const u8) !*albedo.Bucket {
    const bucket = try ally.create(albedo.Bucket);
    bucket.* = try albedo.Bucket.openFile(ally, runtimeIo(), path);
    return bucket;
}

fn open_with_options(js: *napigen.JsContext, path: []const u8, optionsBuf: napigen.napi_value) !*albedo.Bucket {
    const bucket = try ally.create(albedo.Bucket);
    const doc = try bson.jsObjectToBsonDoc(js, optionsBuf, ally);
    const options = try albedo.bson.fmt.parse(albedo.Bucket.OpenBucketOptions, doc, ally);
    bucket.* = try albedo.Bucket.openFileWithOptions(ally, runtimeIo(), path, options.value);
    return bucket;
}

fn close(bucket: *albedo.Bucket) void {
    bucket.deinit();
    bucket.allocator.destroy(bucket);
}

fn getTypedArraySlice(js: *napigen.JsContext, value: napigen.napi_value) ![]const u8 {
    const napi = napigen.napi;

    var is_buffer: bool = false;
    try napigen.check(napi.napi_is_buffer(js.env, value, &is_buffer));
    if (is_buffer) {
        var data_ptr: ?*anyopaque = null;
        var length: usize = 0;
        try napigen.check(napi.napi_get_buffer_info(js.env, value, &data_ptr, &length));
        if (data_ptr == null) return error.InvalidTypedArray;
        const ptr = @as([*]const u8, @ptrCast(data_ptr.?));
        return ptr[0..length];
    }

    var is_typed_array: bool = false;
    try napigen.check(napi.napi_is_typedarray(js.env, value, &is_typed_array));
    if (!is_typed_array) return error.InvalidTypedArray;

    var typed_array_type: napi.napi_typedarray_type = undefined;
    var length: usize = 0;
    var data_ptr: ?*anyopaque = null;
    try napigen.check(napi.napi_get_typedarray_info(js.env, value, &typed_array_type, &length, &data_ptr, null, null));
    if (data_ptr == null) return error.InvalidTypedArray;
    if (typed_array_type != napi.napi_uint8_array and typed_array_type != napi.napi_uint8_clamped_array) return error.InvalidTypedArray;

    const ptr = @as([*]const u8, @ptrCast(data_ptr.?));
    return ptr[0..length];
}

fn createUint8Array(env: napigen.napi_env, data: []const u8) !napigen.napi_value {
    const napi = napigen.napi;
    var buffer: napigen.napi_value = undefined;
    var uint8arr: napigen.napi_value = undefined;
    var data_ptr: ?*anyopaque = null;
    try napigen.check(napi.napi_create_arraybuffer(env, data.len, &data_ptr, &buffer));
    if (data_ptr == null) return error.InvalidTypedArray;
    const dst = @as([*]u8, @ptrCast(data_ptr.?));
    @memcpy(dst[0..data.len], data);
    try napigen.check(napi.napi_create_typedarray(env, napi.napi_uint8_array, data.len, buffer, 0, &uint8arr));
    return uint8arr;
}

fn replicationCursorToJs(js: *napigen.JsContext, cursor: albedo.ReplicationCursor) !napigen.napi_value {
    const obj = try js.createObject();
    try js.setNamedProperty(obj, "generation", try js.createNumber(cursor.generation));
    try js.setNamedProperty(obj, "next_frame_index", try js.createNumber(cursor.next_frame_index));
    return obj;
}

fn replicationCursorFromJs(js: *napigen.JsContext, value: napigen.napi_value) !albedo.ReplicationCursor {
    const payload = try js.read(ReplicationCursorPayload, value);
    return .{
        .generation = payload.generation,
        .next_frame_index = payload.next_frame_index,
    };
}

fn list(js: *napigen.JsContext, bucket: *albedo.Bucket, queryBuf: napigen.napi_value) !*albedo.Bucket.ListIterator {
    const arena = try ally.create(std.heap.ArenaAllocator);
    arena.* = std.heap.ArenaAllocator.init(ally);

    const queryDoc = blk: {
        var is_typed_array = false;
        try napigen.check(napigen.napi.napi_is_typedarray(js.env, queryBuf, &is_typed_array));
        if (is_typed_array) {
            const js_bytes = try getTypedArraySlice(js, queryBuf);
            break :blk albedo.BSONDocument{ .buffer = js_bytes };
        } else if (try js.typeOf(queryBuf) == napigen.napi.napi_object) {
            const doc = try bson.jsObjectToBsonDoc(js, queryBuf, arena.allocator());
            break :blk doc;
        } else {
            arena.deinit();
            return error.InvalidQuery;
        }
    };

    const query = try albedo.Query.parse(arena.allocator(), queryDoc);
    const cursor = try bucket.listIterate(arena, query);
    return cursor;
}

fn listClose(cursor: *albedo.Bucket.ListIterator) !void {
    try cursor.deinit();
    cursor.arena.deinit();
}

fn listData(js: *napigen.JsContext, cursor: *albedo.Bucket.ListIterator) !napigen.napi_value {
    const doc = try cursor.next(cursor);
    if (doc == null) return js.null();

    return try bson.bsonDocToJsObject(js, doc.?, false);
}

fn insert(js: *napigen.JsContext, bucket: *albedo.Bucket, docBuf: napigen.napi_value) !void {
    var is_typed_array = false;
    try napigen.check(napigen.napi.napi_is_typedarray(js.env, docBuf, &is_typed_array));
    if (is_typed_array) {
        const js_bytes = try getTypedArraySlice(js, docBuf);
        const doc = albedo.BSONDocument{ .buffer = js_bytes };
        _ = try bucket.insert(doc);
    } else if (try js.typeOf(docBuf) == napigen.napi.napi_object) {
        const doc = try bson.jsObjectToBsonDoc(js, docBuf, ally);
        _ = try bucket.insert(doc);
    } else {
        return error.InvalidDocument;
    }
}

fn checkpoint(bucket: *albedo.Bucket) !void {
    try bucket.checkpoint();
}

fn transactionBegin(bucket: *albedo.Bucket) !*albedo.Bucket.Transaction {
    return try bucket.beginTransaction();
}

fn transactionInsert(js: *napigen.JsContext, tx: *albedo.Bucket.Transaction, docBuf: napigen.napi_value) !void {
    var is_typed_array = false;
    try napigen.check(napigen.napi.napi_is_typedarray(js.env, docBuf, &is_typed_array));
    if (is_typed_array) {
        const js_bytes = try getTypedArraySlice(js, docBuf);
        const doc = albedo.BSONDocument{ .buffer = js_bytes };
        _ = try tx.insert(doc);
    } else if (try js.typeOf(docBuf) == napigen.napi.napi_object) {
        const doc = try bson.jsObjectToBsonDoc(js, docBuf, ally);
        _ = try tx.insert(doc);
    } else {
        return error.InvalidDocument;
    }
}

const IndexOptions = struct {
    unique: bool,
    sparse: bool,
    reverse: bool,
};

fn ensureIndex(bucket: *albedo.Bucket, name: []const u8, options: IndexOptions) !void {
    try bucket.ensureIndex(name, .{
        .reverse = @intFromBool(options.reverse),
        .sparse = @intFromBool(options.sparse),
        .unique = @intFromBool(options.unique),
    });
}

fn listIndexes(js: *napigen.JsContext, bucket: *albedo.Bucket) !napigen.napi_value {
    const localAlly =
        js.arena.allocator();
    const data = try bucket.listIndexes();
    const returnObject = try js.createObject();
    for (data.indexes[0..]) |entry| {
        const indexObject = try js.createObject();
        const sentinelKey = try localAlly.allocSentinel(u8, entry.key.len, 0);
        defer localAlly.free(sentinelKey);
        @memcpy(sentinelKey[0..entry.key.len], entry.key);
        try js.setNamedProperty(indexObject, "name", try js.createString(entry.key));
        try js.setNamedProperty(indexObject, "unique", try js.createBoolean((entry.value.options.unique == 1)));
        try js.setNamedProperty(indexObject, "sparse", try js.createBoolean((entry.value.options.sparse == 1)));
        try js.setNamedProperty(indexObject, "reverse", try js.createBoolean((entry.value.options.reverse == 1)));
        try js.setNamedProperty(returnObject, sentinelKey, indexObject);
    }
    return returnObject;
}

fn dropIndex(bucket: *albedo.Bucket, name: []const u8) !void {
    try bucket.dropIndex(name);
}

fn delete(js: *napigen.JsContext, bucket: *albedo.Bucket, queryObj: napigen.napi_value) !void {
    var arena = std.heap.ArenaAllocator.init(ally);
    defer arena.deinit();
    const arena_ally = arena.allocator();

    const queryDoc = try bson.jsObjectToBsonDoc(js, queryObj, arena_ally);
    var query = albedo.Query.parse(arena_ally, queryDoc) catch {
        return error.InvalidQuery;
    };
    defer query.deinit(arena_ally);

    try bucket.delete(query);
}

fn transactionDelete(js: *napigen.JsContext, tx: *albedo.Bucket.Transaction, queryObj: napigen.napi_value) !void {
    var arena = std.heap.ArenaAllocator.init(ally);
    defer arena.deinit();
    const arena_ally = arena.allocator();

    const queryDoc = try bson.jsObjectToBsonDoc(js, queryObj, arena_ally);
    var query = albedo.Query.parse(arena_ally, queryDoc) catch {
        return error.InvalidQuery;
    };
    defer query.deinit(arena_ally);

    try tx.delete(query);
}

fn parseUpdateProgram(
    js: *napigen.JsContext,
    programObj: napigen.napi_value,
    arena_ally: std.mem.Allocator,
) !albedo.UpdateProgram {
    var is_typed_array = false;
    try napigen.check(napigen.napi.napi_is_typedarray(js.env, programObj, &is_typed_array));
    if (is_typed_array) {
        const js_bytes = try getTypedArraySlice(js, programObj);
        return try albedo.UpdateProgram.parse(arena_ally, albedo.BSONDocument.init(js_bytes));
    }

    if (try js.typeOf(programObj) == napigen.napi.napi_object) {
        const doc = try bson.jsObjectToBsonDoc(js, programObj, arena_ally);
        return try albedo.UpdateProgram.parse(arena_ally, doc);
    }

    return error.InvalidUpdateProgram;
}

fn transfigurate(
    js: *napigen.JsContext,
    bucket: *albedo.Bucket,
    queryObj: napigen.napi_value,
    programObj: napigen.napi_value,
) !u32 {
    var arena = std.heap.ArenaAllocator.init(ally);
    defer arena.deinit();
    const arena_ally = arena.allocator();

    const queryDoc = try bson.jsObjectToBsonDoc(js, queryObj, arena_ally);
    var query = albedo.Query.parse(arena_ally, queryDoc) catch {
        return error.InvalidQuery;
    };
    defer query.deinit(arena_ally);

    var program = try parseUpdateProgram(js, programObj, arena_ally);
    defer program.deinit(arena_ally);

    return @intCast(try bucket.transfigurate(query, program));
}

fn transactionTransfigurate(
    js: *napigen.JsContext,
    tx: *albedo.Bucket.Transaction,
    queryObj: napigen.napi_value,
    programObj: napigen.napi_value,
) !u32 {
    var arena = std.heap.ArenaAllocator.init(ally);
    defer arena.deinit();
    const arena_ally = arena.allocator();

    const queryDoc = try bson.jsObjectToBsonDoc(js, queryObj, arena_ally);
    var query = albedo.Query.parse(arena_ally, queryDoc) catch {
        return error.InvalidQuery;
    };
    defer query.deinit(arena_ally);

    var program = try parseUpdateProgram(js, programObj, arena_ally);
    defer program.deinit(arena_ally);

    return @intCast(try tx.transfigurate(query, program));
}

fn transformTransfigurate(
    js: *napigen.JsContext,
    iter: *albedo.Bucket.TransformIterator,
    programObj: napigen.napi_value,
) !void {
    var arena = std.heap.ArenaAllocator.init(ally);
    defer arena.deinit();
    const arena_ally = arena.allocator();

    var program = try parseUpdateProgram(js, programObj, arena_ally);
    defer program.deinit(arena_ally);

    try iter.transfigurate(program);
}

fn transform(js: *napigen.JsContext, bucket: *albedo.Bucket, queryObj: napigen.napi_value) !*albedo.Bucket.TransformIterator {
    const arena = try ally.create(std.heap.ArenaAllocator);
    arena.* = std.heap.ArenaAllocator.init(ally);

    const queryDoc = try bson.jsObjectToBsonDoc(js, queryObj, arena.allocator());
    const query = try albedo.Query.parse(arena.allocator(), queryDoc);

    const iter = try bucket.transformIterate(arena, query);
    iter.owns_arena = true;
    return iter;
}

fn transactionTransform(js: *napigen.JsContext, tx: *albedo.Bucket.Transaction, queryObj: napigen.napi_value) !*albedo.Bucket.TransformIterator {
    const arena = try ally.create(std.heap.ArenaAllocator);
    arena.* = std.heap.ArenaAllocator.init(ally);

    const queryDoc = try bson.jsObjectToBsonDoc(js, queryObj, arena.allocator());
    const query = try albedo.Query.parse(arena.allocator(), queryDoc);

    const iter = try tx.transformIterate(arena, query);
    iter.owns_arena = true;
    return iter;
}

fn transformData(js: *napigen.JsContext, iter: *albedo.Bucket.TransformIterator) !napigen.napi_value {
    const result = try iter.data();
    if (result == null) return null;

    return try bson.bsonDocToJsObject(js, result.?, false);
}

fn transformApply(js: *napigen.JsContext, iter: *albedo.Bucket.TransformIterator, replaceBuffer: napigen.napi_value) !void {
    const doc: ?*const albedo.BSONDocument = blk: {
        if (try js.typeOf(replaceBuffer) == napigen.napi.napi_null) {
            break :blk null;
        }
        var is_typed_array = false;
        try napigen.check(napigen.napi.napi_is_typedarray(js.env, replaceBuffer, &is_typed_array));
        if (is_typed_array) {
            const js_bytes = try getTypedArraySlice(js, replaceBuffer);
            break :blk &albedo.BSONDocument.init(js_bytes);
        }
        if (try js.typeOf(replaceBuffer) == napigen.napi.napi_object) {
            const doc = try bson.jsObjectToBsonDoc(js, replaceBuffer, iter.arena.allocator());
            break :blk &doc;
        }
        return error.InvalidDocument;
    };

    try iter.transform(doc);
}

fn transformClose(iter: *albedo.Bucket.TransformIterator) !void {
    try iter.close();
}

fn transactionCommit(tx: *albedo.Bucket.Transaction) !void {
    try tx.commit();
}

fn transactionRollback(tx: *albedo.Bucket.Transaction) !void {
    try tx.rollback();
}

fn transactionClose(tx: *albedo.Bucket.Transaction) !void {
    try tx.close();
}

fn subscribe(js: *napigen.JsContext, bucket: *albedo.Bucket, queryBuf: napigen.napi_value) !*albedo.Bucket.Subscription {
    var owned_doc: ?albedo.BSONDocument = null;
    defer if (owned_doc) |doc| doc.deinit(ally);

    const queryDoc = blk: {
        var is_typed_array = false;
        try napigen.check(napigen.napi.napi_is_typedarray(js.env, queryBuf, &is_typed_array));
        if (is_typed_array) {
            const js_bytes = try getTypedArraySlice(js, queryBuf);
            break :blk albedo.BSONDocument{ .buffer = js_bytes };
        } else if (try js.typeOf(queryBuf) == napigen.napi.napi_object) {
            const doc = try bson.jsObjectToBsonDoc(js, queryBuf, ally);
            owned_doc = doc;
            break :blk doc;
        } else {
            return error.InvalidQuery;
        }
    };

    var query = try albedo.Query.parse(ally, queryDoc);
    return bucket.subscribe(query) catch |err| {
        query.deinit(ally);
        return err;
    };
}

fn subscribePoll(js: *napigen.JsContext, sub: *albedo.Bucket.Subscription, maxEvents: u32) !napigen.napi_value {
    const batch = try sub.poll(maxEvents);
    if (batch == null) return js.null();

    return try bson.bsonDocToJsObject(js, batch.?, false);
}

fn subscribeClose(sub: *albedo.Bucket.Subscription) void {
    sub.deinit();
}

fn replicationCursor(js: *napigen.JsContext, bucket: *albedo.Bucket) !napigen.napi_value {
    return try replicationCursorToJs(js, try bucket.replicationCursor());
}

fn readReplicationBatch(js: *napigen.JsContext, bucket: *albedo.Bucket, cursorValue: napigen.napi_value, max_bytes: u32) !napigen.napi_value {
    const cursor = try replicationCursorFromJs(js, cursorValue);
    const batch = (try bucket.readReplicationBatch(cursor, max_bytes, ally)) orelse return js.null();
    defer ally.free(batch);
    return try createUint8Array(js.env, batch);
}

fn applyReplicationBatch(js: *napigen.JsContext, bucket: *albedo.Bucket, data: napigen.napi_value) !napigen.napi_value {
    const js_bytes = try getTypedArraySlice(js, data);
    return try replicationCursorToJs(js, try bucket.applyReplicationBatch(js_bytes));
}

fn initModule(js: *napigen.JsContext, exports: napigen.napi_value) anyerror!napigen.napi_value {
    var objectIdConstructor: napigen.napi_value = undefined;
    try napigen.check(napigen.napi.napi_define_class(js.env, "ObjectId", napigen.napi.NAPI_AUTO_LENGTH, objectIdConstructorFunction, null, 0, null, &objectIdConstructor));

    var objectIdProto: napigen.napi_value = undefined;
    try napigen.check(napigen.napi.napi_get_named_property(js.env, objectIdConstructor, "prototype", &objectIdProto));

    var objectIdToString: napigen.napi_value = undefined;
    try napigen.check(napigen.napi.napi_create_function(js.env, "toString", napigen.napi.NAPI_AUTO_LENGTH, objectIdToStringFunction, null, &objectIdToString));
    try napigen.check(napigen.napi.napi_set_named_property(js.env, objectIdProto, "toString", objectIdToString));

    var objectIdFromString: napigen.napi.napi_value = undefined;
    try napigen.check(napigen.napi.napi_create_function(js.env, "fromString", napigen.napi.NAPI_AUTO_LENGTH, objectIdFromStringFunction, null, &objectIdFromString));
    try napigen.check(napigen.napi.napi_set_named_property(js.env, objectIdConstructor, "fromString", objectIdFromString));

    try js.setNamedProperty(exports, "ObjectId", objectIdConstructor);
    try js.setNamedProperty(exports, "serialize", try js.createNamedFunction("serialize", bson.serialize));
    try js.setNamedProperty(exports, "deserialize", try js.createNamedFunction("deserialize", bson.deserialize));
    try js.setNamedProperty(exports, "open", try js.createFunction(open));
    try js.setNamedProperty(exports, "open_with_options", try js.createFunction(open_with_options));
    try js.setNamedProperty(exports, "close", try js.createFunction(close));
    try js.setNamedProperty(exports, "list", try js.createFunction(list));
    try js.setNamedProperty(exports, "listClose", try js.createFunction(listClose));
    try js.setNamedProperty(exports, "listData", try js.createFunction(listData));
    try js.setNamedProperty(exports, "insert", try js.createFunction(insert));
    try js.setNamedProperty(exports, "checkpoint", try js.createFunction(checkpoint));
    try js.setNamedProperty(exports, "transactionBegin", try js.createFunction(transactionBegin));
    try js.setNamedProperty(exports, "transactionInsert", try js.createFunction(transactionInsert));
    try js.setNamedProperty(exports, "ensureIndex", try js.createFunction(ensureIndex));
    try js.setNamedProperty(exports, "listIndexes", try js.createFunction(listIndexes));
    try js.setNamedProperty(exports, "dropIndex", try js.createFunction(dropIndex));
    try js.setNamedProperty(exports, "delete", try js.createFunction(delete));
    try js.setNamedProperty(exports, "transactionDelete", try js.createFunction(transactionDelete));
    try js.setNamedProperty(exports, "transform", try js.createFunction(transform));
    try js.setNamedProperty(exports, "transactionTransform", try js.createFunction(transactionTransform));
    try js.setNamedProperty(exports, "transformClose", try js.createFunction(transformClose));
    try js.setNamedProperty(exports, "transformData", try js.createFunction(transformData));
    try js.setNamedProperty(exports, "transformApply", try js.createFunction(transformApply));
    try js.setNamedProperty(exports, "transfigurate", try js.createFunction(transfigurate));
    try js.setNamedProperty(exports, "transactionTransfigurate", try js.createFunction(transactionTransfigurate));
    try js.setNamedProperty(exports, "transformTransfigurate", try js.createFunction(transformTransfigurate));
    try js.setNamedProperty(exports, "transactionCommit", try js.createFunction(transactionCommit));
    try js.setNamedProperty(exports, "transactionRollback", try js.createFunction(transactionRollback));
    try js.setNamedProperty(exports, "transactionClose", try js.createFunction(transactionClose));
    try js.setNamedProperty(exports, "subscribe", try js.createFunction(subscribe));
    try js.setNamedProperty(exports, "subscribePoll", try js.createFunction(subscribePoll));
    try js.setNamedProperty(exports, "subscribeClose", try js.createFunction(subscribeClose));
    try js.setNamedProperty(exports, "replicationCursor", try js.createFunction(replicationCursor));
    try js.setNamedProperty(exports, "readReplicationBatch", try js.createFunction(readReplicationBatch));
    try js.setNamedProperty(exports, "applyReplicationBatch", try js.createFunction(applyReplicationBatch));
    var ctor_ref: napigen.napi.napi_ref = undefined;
    try napigen.check(napigen.napi.napi_create_reference(js.env, objectIdConstructor, 1, &ctor_ref));
    bson.objectIdConstructorRef = ctor_ref;
    return exports;
}

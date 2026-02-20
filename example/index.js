import { BSON, Bucket } from "albedo-node";
import Database from "bun:sqlite";
import { unlinkSync } from "fs";

const docNum = 100000;

const sqliteDb = new Database("db.sqlite");
sqliteDb
  .prepare(
    `
  CREATE TABLE IF NOT EXISTS documents (
    _id INTEGER PRIMARY KEY,
    doc JSON
  );
`,
  )
  .run();

sqliteDb.prepare("drop index IF EXISTS idx_doc_id;").run();
sqliteDb.prepare("create unique index idx_doc_id on documents(json_extract(doc, '$._id'));").run();

console.time("Insert 100000 documents into SQLite");
const insertStmt = sqliteDb.prepare("INSERT INTO documents (doc) VALUES (json(?))");
for (let i = 0; i < docNum; i++) {
    insertStmt.run(JSON.stringify({
      _id: i,
      name: `Name ${i}`,
      age: i,
    }));
}
console.timeEnd("Insert 100000 documents into SQLite");

console.time("Query scan x 100 in SQLite");
for (let i = 0; i < 100; i++) {
  const row = sqliteDb
    .prepare("SELECT doc FROM documents WHERE json_extract(doc, '$.age') = ? LIMIT 100")
    .get(Math.floor(Math.random() * docNum));
  if (row) JSON.parse(row.doc);
}
console.timeEnd("Query scan x 100 in SQLite");

console.time("Query index x 100 in SQLite");
for (let i = 0; i < 100; i++) {
  const row = sqliteDb
    .prepare(
      "SELECT doc FROM documents WHERE json_extract(doc, '$._id') = ? LIMIT 100",
    )
    .get(Math.floor(Math.random() * docNum));
  if (row) JSON.parse(row.doc);
}
console.timeEnd("Query index x 100 in SQLite");

sqliteDb.close();

const bucket = Bucket.open("db.bucket");

// bucket.dropIndex("_id");

console.time("Insert 100000 documents");
for (let i = 0; i < docNum; i++) {
  bucket.insert({
    _id: i,
    name: `Name ${i}`,
    age: i,
  });
}
console.timeEnd("Insert 100000 documents");

console.time("Query scan x 100");
for (let i = 0; i < 100; i++) {
  bucket
    .list({
      query: { age: Math.floor(Math.random() * docNum) },
      sector: { limit: 100 },
    })
    .next();
}
console.timeEnd("Query scan x 100");

console.time("Query index x 100");
for (let i = 0; i < 100; i++) {
  
  bucket
    .list({
      query: { _id: Math.floor(Math.random() * docNum) },
      sector: { limit: 100 },
    })
    .next();
}
console.timeEnd("Query index x 100");

bucket.close();

unlinkSync("db.sqlite");
unlinkSync("db.bucket");
import { Bucket } from "albedo-node";
import Database from "bun:sqlite";

const sqliteDb = new Database("db.sqlite");
sqliteDb
  .prepare(
    `
  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    name TEXT,
    age INTEGER
  );
`,
  )
  .run();

sqliteDb.prepare("create index IF NOT EXISTS idx_id on documents(id);").run();

console.time("Insert 1000 documents into SQLite");
for (let i = 0; i < 10000; i++) {
  sqliteDb
    .prepare("INSERT INTO documents (id, name, age) VALUES (?, ?, ?)")
    .run(`id_${i}`, `Name ${i}`, 20 + (i % 30));
}
console.timeEnd("Insert 1000 documents into SQLite");

console.time("Query scan x 1000 in SQLite");
for (let i = 0; i < 1000; i++) {
  sqliteDb
    .prepare("SELECT * FROM documents WHERE age = ? LIMIT 1")
    .get(Math.floor(Math.random() * 30) + 20);
}
console.timeEnd("Query scan x 1000 in SQLite");

console.time("Query index x 1000 in SQLite");
for (let i = 0; i < 1000; i++) {
  sqliteDb
    .prepare("SELECT * FROM documents WHERE id = ? LIMIT 1")
    .get(`id_${Math.floor(Math.random() * 10000)}`);
}
console.timeEnd("Query index x 1000 in SQLite");

sqliteDb.close();

const bucket = Bucket.open("db.bucket");

console.time("Insert 1000 documents");
for (let i = 0; i < 10000; i++) {
  bucket.insert({
    _id: `id_${i}`,
    name: `Name ${i}`,
    age: 20 + (i % 30),
  });
}
console.timeEnd("Insert 1000 documents");

console.time("Query scan x 1000");
for (let i = 0; i < 1000; i++) {
  bucket
    .list({
      query: { age: Math.floor(Math.random() * 30) + 20 },
      sector: { limit: 1 },
    })
    .toArray();
}
console.timeEnd("Query scan x 1000");

console.time("Query index x 1000");
for (let i = 0; i < 1000; i++) {
  bucket
    .list({
      query: { _id: `id_${Math.floor(Math.random() * 10000)}` },
      sector: { limit: 1 },
    })
    .toArray();
}
console.timeEnd("Query index x 1000");

bucket.close();

const sqlite3 = require('sqlite3').verbose();
const path    = require('path');

const dbPath = path.join(__dirname, 'jusbooks.db');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Database connection failed:', err.message);
  } else {
    console.log('Connected to SQLite database.');
  }
});

// Enable foreign key enforcement (SQLite requires this per connection)
db.run('PRAGMA foreign_keys = ON');

module.exports = db;

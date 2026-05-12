const db = require('./database/db');
db.run("UPDATE borrow_transactions SET due_date = datetime('now', '-5 days') WHERE status = 'active'", function(err) {
  if (err) console.error(err);
  else console.log('Done — ' + this.changes + ' transaction(s) backdated');
  process.exit(0);
});

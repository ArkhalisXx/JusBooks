const db = require('./database/db');
db.run("UPDATE borrow_transactions SET due_date = datetime('now', '+14 days') WHERE status = 'active'", function(err) {
  if (err) console.error(err);
  else console.log('Done — ' + this.changes + ' transaction(s) reset to 14 days from now');
  process.exit(0);
});

/**
 * JusBooks — Database Seeder
 * Run ONCE: node seed.js
 * Creates a librarian account and sample books + one member.
 */

require('dotenv').config();
const { User } = require('./models/User');
const db = require('./database/db');

// Run setup first
require('./database/setup');

// Wait a moment for tables to be created
setTimeout(async () => {
  try {
    console.log('\n📦 Seeding JusBooks database...\n');

    const librarianPassword = await User.hashPassword('librarian123');
    const memberPassword    = await User.hashPassword('member123');

    // Insert librarian
    db.run(
      `INSERT OR IGNORE INTO users (username, email, password, role, membership_status, borrow_limit, outstanding_fines)
       VALUES (?, ?, ?, 'librarian', 'active', 0, 0)`,
      ['Admin Librarian', 'librarian@jusbooks.com', librarianPassword],
      function(err) {
        if (err) console.error('Librarian insert error:', err.message);
        else console.log('✅ Librarian created: librarian@jusbooks.com / librarian123');
      }
    );

    // Insert test member
    db.run(
      `INSERT OR IGNORE INTO users (username, email, password, role, membership_status, borrow_limit, outstanding_fines)
       VALUES (?, ?, ?, 'member', 'active', 5, 0)`,
      ['Maria Santos', 'maria@example.com', memberPassword],
      function(err) {
        if (err) console.error('Member insert error:', err.message);
        else console.log('✅ Member created: maria@example.com / member123');
      }
    );

    // Insert sample books
    const books = [
      ['Noli Me Tangere',          'José Rizal',          '9789711804107', 'Fiction',     5, 'Landmark novel of the Philippine literary canon.'],
      ['El Filibusterismo',         'José Rizal',          '9789711804114', 'Fiction',     3, 'Sequel to Noli Me Tangere.'],
      ['Thinking, Fast and Slow',   'Daniel Kahneman',     '9780374533557', 'Non-Fiction', 4, 'Explores dual-process theory of the mind.'],
      ['Clean Code',                'Robert C. Martin',    '9780132350884', 'Technology',  6, 'A handbook of agile software craftsmanship.'],
      ['Sapiens',                   'Yuval Noah Harari',   '9780062316097', 'History',     5, 'A brief history of humankind.'],
      ['The Great Gatsby',          'F. Scott Fitzgerald', '9780743273565', 'Fiction',     4, 'The Jazz Age and the American Dream.'],
      ['The Art of War',            'Sun Tzu',             '9780981952208', 'Philosophy',  7, 'Ancient Chinese military treatise.'],
      ['Introduction to Algorithms','Cormen et al.',       '9780262033848', 'Technology',  3, 'Comprehensive algorithms textbook.'],
    ];

    let bookCount = 0;
    for (const [title, author, isbn, category, qty, desc] of books) {
      db.run(
        `INSERT OR IGNORE INTO books (title, author, isbn, category, quantity, available_qty, description)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [title, author, isbn, category, qty, qty, desc],
        function(err) {
          if (err) console.error(`Book insert error (${title}):`, err.message);
          else if (this.changes > 0) {
            bookCount++;
            if (bookCount === books.length) {
              console.log(`✅ ${bookCount} books inserted`);
              console.log('\n🎉 Seed complete!\n');
              console.log('Login credentials:');
              console.log('  Librarian: librarian@jusbooks.com / librarian123');
              console.log('  Member:    maria@example.com / member123\n');
              process.exit(0);
            }
          }
        }
      );
    }

  } catch (e) {
    console.error('Seed error:', e.message);
    process.exit(1);
  }
}, 500);

/**
 * JusBooks — Class Tester
 * Run: node tester.js
 *
 * Tests all completed classes without needing a real DB or API keys.
 * DB calls are replaced with mock functions.
 * API calls (Payment, Notification) are skipped with clear messages.
 */

const { User }           = require("./models/User");
const Member             = require("./models/Member");
const Librarian          = require("./models/Librarian");
const Book               = require("./models/Book");
const BorrowTransaction  = require("./models/BorrowTransaction");
const Fine               = require("./models/Fine");
const Payment            = require("./models/Payment");
const Reservation        = require("./models/Reservation");
const Notification       = require("./models/Notification");
const Report             = require("./models/Report");
const { authenticate, authorize, ownDataOnly } = require("./middleware/auth");

// ── Helpers ───────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const results = [];

function test(name, fn) {
  try {
    const result = fn();
    if (result instanceof Promise) {
      return result.then(() => {
        console.log(`  ✅ PASS  ${name}`);
        results.push({ name, status: "PASS" });
        passed++;
      }).catch(err => {
        console.log(`  ❌ FAIL  ${name}`);
        console.log(`         → ${err.message}`);
        results.push({ name, status: "FAIL", error: err.message });
        failed++;
      });
    }
    console.log(`  ✅ PASS  ${name}`);
    results.push({ name, status: "PASS" });
    passed++;
  } catch (err) {
    console.log(`  ❌ FAIL  ${name}`);
    console.log(`         → ${err.message}`);
    results.push({ name, status: "FAIL", error: err.message });
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || "Assertion failed");
}

function section(title) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${"─".repeat(60)}`);
}

// ── Mock DB Adapter ────────────────────────────────────────────────────────────

let nextID = 100;

const mockDB = {
  insertTransaction : async (r) => ({ transactionID: ++nextID }),
  updateTransaction : async (id, d) => {},
  decrementBookStock: async (id) => {},
  incrementBookStock: async (id) => {},
  insertFine        : async (f) => ({ fineID: ++nextID }),
  updateMemberFines : async (id, amt) => {},
  insertReservation : async (r) => ({ reservationID: ++nextID }),
  updateReservationStatus: async (id, s) => {},
  query             : async (sql, vals) => [],   // returns empty rows for report
};

// ── Mock Express req/res/next ──────────────────────────────────────────────────

function mockRes() {
  const res = {
    _status: null, _body: null,
    status(code) { this._status = code; return this; },
    json(body)   { this._body   = body; return this; },
  };
  return res;
}

// ══════════════════════════════════════════════════════════════════════════════
//  SECTION 1 — User (abstract base)
// ══════════════════════════════════════════════════════════════════════════════
section("1. User — Abstract Base Class");

test("Cannot instantiate User directly", () => {
  let threw = false;
  try { new User(1, "u", "e@e.com", "hash", "member"); } catch { threw = true; }
  assert(threw, "Should have thrown");
});

test("hashPassword returns bcrypt hash", async () => {
  const hash = await User.hashPassword("securePass123");
  assert(hash.startsWith("$2b$"), "Expected bcrypt hash starting with $2b$");
});

test("verifyPassword returns true for correct password", async () => {
  const hash = await User.hashPassword("securePass123");
  const ok   = await User.verifyPassword("securePass123", hash);
  assert(ok === true, "Should be true");
});

test("verifyPassword returns false for wrong password", async () => {
  const hash = await User.hashPassword("securePass123");
  const ok   = await User.verifyPassword("wrongPass", hash);
  assert(ok === false, "Should be false");
});

test("hashPassword rejects short password (<8 chars)", async () => {
  let threw = false;
  try { await User.hashPassword("short"); } catch { threw = true; }
  assert(threw, "Should reject short password");
});

// ══════════════════════════════════════════════════════════════════════════════
//  SECTION 2 — JWT
// ══════════════════════════════════════════════════════════════════════════════
section("2. JWT — Token Generation & Verification");

let sharedToken;

test("Librarian generates a valid JWT", () => {
  const lib  = new Librarian(99, "admin", "admin@lib.com", "hash", 1, "Main");
  sharedToken = lib.generateToken();
  assert(typeof sharedToken === "string" && sharedToken.length > 20, "Token too short");
});

test("verifyToken decodes correct payload", () => {
  const decoded = User.verifyToken(sharedToken);
  assert(decoded.role === "librarian", "Role mismatch");
  assert(decoded.username === "admin", "Username mismatch");
  assert(decoded.userID === 99, "userID mismatch");
});

test("verifyToken throws on tampered token", () => {
  let threw = false;
  try { User.verifyToken(sharedToken + "tampered"); } catch { threw = true; }
  assert(threw, "Should reject tampered token");
});

test("Member generates token with role=member", () => {
  const m = new Member(1, "alice", "alice@email.com", "hash", "active");
  const t = m.generateToken();
  const d = User.verifyToken(t);
  assert(d.role === "member", "Should be member role");
});

test("toPublic() does not expose password", () => {
  const m = new Member(1, "alice", "alice@email.com", "supersecret", "active");
  const pub = m.toPublic();
  assert(!pub.password, "Password should not be in toPublic()");
});

// ══════════════════════════════════════════════════════════════════════════════
//  SECTION 3 — Member
// ══════════════════════════════════════════════════════════════════════════════
section("3. Member — Eligibility, Borrow, Return, Fine, Reserve");

const activeMember  = new Member(1, "alice", "alice@lib.com", "hash", "active",  5, 0);
const finedMember   = new Member(2, "bob",   "bob@lib.com",   "hash", "active",  5, 50);
const suspendedMem  = new Member(3, "carol", "carol@lib.com", "hash", "suspended", 5, 0);
const sampleBook    = new Book(10, "Clean Code", "Martin", "9780132350884", "Tech", 5, 3);

test("Active member with no fines is eligible", () => {
  const { eligible, reason } = activeMember.checkEligibility(2);
  assert(eligible === true, reason);
});

test("Member with fines is ineligible", () => {
  const { eligible, reason } = finedMember.checkEligibility(2);
  assert(eligible === false, "Should be ineligible");
  assert(reason.includes("fines"), "Reason should mention fines");
});

test("Member at borrow limit is ineligible", () => {
  const { eligible, reason } = activeMember.checkEligibility(5); // at limit
  assert(eligible === false, "Should be ineligible");
  assert(reason.includes("limit"), "Reason should mention limit");
});

test("Suspended member is ineligible", () => {
  const { eligible } = suspendedMem.checkEligibility(0);
  assert(eligible === false, "Suspended member should be ineligible");
});

test("borrowBook returns a valid transaction record", () => {
  const tx = activeMember.borrowBook(sampleBook, 2, 14);
  assert(tx.memberID === 1, "memberID mismatch");
  assert(tx.bookID   === 10, "bookID mismatch");
  assert(tx.status   === "active", "status should be active");
  assert(tx.dueDate > tx.issueDate, "dueDate should be after issueDate");
});

test("borrowBook throws if book unavailable", () => {
  const noStock = new Book(11, "No Stock", "X", "9780000000001", "Tech", 5, 0);
  let threw = false;
  try { activeMember.borrowBook(noStock, 2); } catch { threw = true; }
  assert(threw, "Should throw for unavailable book");
});

test("borrowBook throws if member has fines", () => {
  let threw = false;
  try { finedMember.borrowBook(sampleBook, 2); } catch { threw = true; }
  assert(threw, "Should throw for fined member");
});

test("returnBook on-time returns fineAmount=0", () => {
  const futureDue = new Date();
  futureDue.setDate(futureDue.getDate() + 5);
  const tx     = { transactionID: 1, bookID: 10, dueDate: futureDue };
  const result = activeMember.returnBook(tx);
  assert(result.fineAmount === 0, "No fine for on-time return");
});

test("returnBook late returns correct fineAmount", () => {
  const pastDue = new Date();
  pastDue.setDate(pastDue.getDate() - 3);
  const tx     = { transactionID: 2, bookID: 10, dueDate: pastDue };
  const result = activeMember.returnBook(tx);
  assert(result.fineAmount === 15, `Expected ₱15, got ₱${result.fineAmount}`);
  assert(result.daysOverdue === 3, "Should be 3 days overdue");
});

test("payFine returns a payment record", () => {
  const member = new Member(4, "dave", "d@d.com", "hash", "active", 5, 25);
  const record = member.payFine(25, "gcash");
  assert(record.amount === 25, "Amount mismatch");
  assert(record.method === "gcash", "Method mismatch");
  assert(record.status === "pending", "Should be pending");
});

test("payFine throws when no fines", () => {
  const freshMember = new Member(99, "fresh", "fresh@lib.com", "hash", "active", 5, 0);
  let threw = false;
  try { freshMember.payFine(10, "gcash"); } catch { threw = true; }
  assert(threw, "Should throw when no fines");
});

test("reserveBook returns a valid reservation record", () => {
  const rec = activeMember.reserveBook(sampleBook);
  assert(rec.memberID === 1, "memberID mismatch");
  assert(rec.bookID   === 10, "bookID mismatch");
  assert(rec.status   === "pending", "status should be pending");
  assert(rec.expiryDate > rec.reservedAt, "Expiry should be after reservation");
});

test("reserveBook throws for suspended member", () => {
  let threw = false;
  try { suspendedMem.reserveBook(sampleBook); } catch { threw = true; }
  assert(threw, "Suspended member cannot reserve");
});

// ══════════════════════════════════════════════════════════════════════════════
//  SECTION 4 — Librarian
// ══════════════════════════════════════════════════════════════════════════════
section("4. Librarian — Book/Member Management, Reports");

const lib = new Librarian(99, "admin", "admin@lib.com", "hash", 1, "Main Branch");

test("manageBooks add validates required fields", () => {
  const payload = lib.manageBooks("add", {
    title: "Design Patterns", author: "GoF", ISBN: "9780201633610",
    category: "Tech", quantity: 3,
  });
  assert(payload.action === "add", "Action should be add");
  assert(payload.payload.availableQty === 3, "availableQty should equal quantity");
});

test("manageBooks add throws on missing field", () => {
  let threw = false;
  try { lib.manageBooks("add", { title: "Incomplete Book" }); } catch { threw = true; }
  assert(threw, "Should throw for missing fields");
});

test("manageBooks edit requires bookID", () => {
  let threw = false;
  try { lib.manageBooks("edit", { title: "Updated" }); } catch { threw = true; }
  assert(threw, "Should throw without bookID");
});

test("manageBooks edit succeeds with bookID", () => {
  const result = lib.manageBooks("edit", { title: "Updated Title" }, 5);
  assert(result.bookID === 5, "bookID mismatch");
  assert(result.action === "edit", "Action should be edit");
});

test("manageBooks delete succeeds with bookID", () => {
  const result = lib.manageBooks("delete", {}, 5);
  assert(result.action === "delete" && result.bookID === 5);
});

test("manageMembers suspend returns correct status", () => {
  const result = lib.manageMembers("suspend", {}, 2);
  assert(result.status === "suspended", "Should be suspended");
});

test("manageMembers activate returns correct status", () => {
  const result = lib.manageMembers("activate", {}, 2);
  assert(result.status === "active", "Should be active");
});

test("manageMembers register validates required fields", () => {
  const result = lib.manageMembers("register", {
    username: "newuser", email: "new@lib.com", password: "pass1234"
  });
  assert(result.action === "register", "Action should be register");
});

test("generateReport returns correct config for all types", () => {
  for (const type of ["borrowed", "overdue", "frequent", "payments"]) {
    const cfg = lib.generateReport(type);
    assert(cfg.reportType === type, `Type mismatch for ${type}`);
  }
});

test("generateReport throws on invalid type", () => {
  let threw = false;
  try { lib.generateReport("invalid_type"); } catch { threw = true; }
  assert(threw, "Should throw for invalid report type");
});

// ══════════════════════════════════════════════════════════════════════════════
//  SECTION 5 — Book
// ══════════════════════════════════════════════════════════════════════════════
section("5. Book — Availability, Stock, Search, Validation");

test("isAvailable returns true when stock > 0", () => {
  const b = new Book(1, "Test", "Auth", "9780132350884", "Tech", 5, 3);
  assert(b.isAvailable() === true);
});

test("isAvailable returns false when stock = 0", () => {
  const b = new Book(2, "Test", "Auth", "9780132350884", "Tech", 5, 0);
  assert(b.isAvailable() === false);
});

test("updateStock decrements correctly", () => {
  const b = new Book(3, "T", "A", "9780132350884", "Tech", 5, 3);
  b.updateStock(-1);
  assert(b.availableQty === 2, "Should be 2");
});

test("updateStock increments correctly", () => {
  const b = new Book(4, "T", "A", "9780132350884", "Tech", 5, 3);
  b.updateStock(+1);
  assert(b.availableQty === 4, "Should be 4");
});

test("updateStock throws on underflow", () => {
  const b = new Book(5, "T", "A", "9780132350884", "Tech", 5, 0);
  let threw = false;
  try { b.updateStock(-1); } catch { threw = true; }
  assert(threw, "Should throw on underflow");
});

test("updateStock throws on overflow", () => {
  const b = new Book(6, "T", "A", "9780132350884", "Tech", 5, 5);
  let threw = false;
  try { b.updateStock(+1); } catch { threw = true; }
  assert(threw, "Should throw on overflow");
});

test("getDetails returns all fields", () => {
  const b = new Book(7, "Clean Code", "Martin", "9780132350884", "Tech", 5, 3);
  const d = b.getDetails();
  assert(d.title === "Clean Code" && d.available === true);
});

test("buildSearchQuery with keyword builds correct WHERE", () => {
  const q = Book.buildSearchQuery({ keyword: "python" });
  assert(q.where.includes("LIKE"), "Should include LIKE");
  assert(q.values.length === 3, "Should have 3 values for title/author/isbn");
});

test("buildSearchQuery with available filter", () => {
  const q = Book.buildSearchQuery({ available: true });
  assert(q.where.includes("available_qty > 0"));
});

test("buildSearchQuery with no params returns '1=1'", () => {
  const q = Book.buildSearchQuery();
  assert(q.where === "1=1", "Should be open query");
});

test("Book.validate throws on invalid ISBN", () => {
  let threw = false;
  try {
    Book.validate({ title: "T", author: "A", ISBN: "123", category: "C", quantity: 1 });
  } catch { threw = true; }
  assert(threw, "Should throw on invalid ISBN");
});

test("Book.validate passes for valid data", () => {
  Book.validate({ title: "T", author: "A", ISBN: "9780132350884", category: "C", quantity: 2 });
});

// ══════════════════════════════════════════════════════════════════════════════
//  SECTION 6 — Fine
// ══════════════════════════════════════════════════════════════════════════════
section("6. Fine — Calculation & Payment");

test("fromTransaction returns null when not overdue", () => {
  const futureDue = new Date();
  futureDue.setDate(futureDue.getDate() + 3);
  const fine = Fine.fromTransaction(1, 1, futureDue);
  assert(fine === null, "Should be null for on-time");
});

test("fromTransaction calculates correct amount (5 days)", () => {
  const pastDue = new Date();
  pastDue.setDate(pastDue.getDate() - 5);
  const fine = Fine.fromTransaction(1, 1, pastDue);
  assert(fine.amount === 25, `Expected ₱25, got ₱${fine.amount}`);
  assert(fine.daysOverdue === 5);
});

test("fromTransaction calculates correct amount (1 day)", () => {
  const pastDue = new Date();
  pastDue.setDate(pastDue.getDate() - 1);
  const fine = Fine.fromTransaction(1, 1, pastDue);
  assert(fine.amount === 5, `Expected ₱5, got ₱${fine.amount}`);
});

test("calculate() updates amount", () => {
  const fine = new Fine(1, 1, 1, 25, 5, false);
  const amt  = fine.calculate(10); // ₱10/day rate
  assert(amt === 50, `Expected ₱50, got ₱${amt}`);
});

test("markPaid sets isPaid=true", () => {
  const fine = new Fine(1, 1, 1, 25, 5, false);
  fine.markPaid(200);
  assert(fine.isPaid === true, "Should be paid");
});

test("markPaid throws if already paid", () => {
  const fine = new Fine(1, 1, 1, 25, 5, true);
  let threw = false;
  try { fine.markPaid(201); } catch { threw = true; }
  assert(threw, "Should throw if already paid");
});

// ══════════════════════════════════════════════════════════════════════════════
//  SECTION 7 — BorrowTransaction
// ══════════════════════════════════════════════════════════════════════════════
section("7. BorrowTransaction — Check-out, Return, Overdue");

test("recordBorrow saves via mock DB and sets transactionID", async () => {
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 14);
  const tx = new BorrowTransaction(null, 1, 10, new Date(), dueDate);
  await tx.recordBorrow(mockDB);
  assert(tx.transactionID !== null, "transactionID should be assigned");
});

test("recordReturn on-time returns null fine", async () => {
  const futureDue = new Date();
  futureDue.setDate(futureDue.getDate() + 7);
  const tx = new BorrowTransaction(101, 1, 10, new Date(), futureDue, null, "active");
  const fine = await tx.recordReturn(mockDB);
  assert(fine === null, "Should be no fine");
  assert(tx.status === "returned", "Status should be returned");
});

test("recordReturn late generates a Fine", async () => {
  const pastDue = new Date();
  pastDue.setDate(pastDue.getDate() - 4);
  const tx   = new BorrowTransaction(102, 1, 10, new Date(), pastDue, null, "active");
  const fine = await tx.recordReturn(mockDB);
  assert(fine !== null, "Should generate a fine");
  assert(fine.amount === 20, `Expected ₱20, got ₱${fine.amount}`);
});

test("recordReturn throws if already returned", async () => {
  const tx = new BorrowTransaction(103, 1, 10, new Date(), new Date(), new Date(), "returned");
  let threw = false;
  try { await tx.recordReturn(mockDB); } catch { threw = true; }
  assert(threw, "Should throw for already returned");
});

test("checkOverdueStatus detects overdue correctly", () => {
  const pastDue = new Date();
  pastDue.setDate(pastDue.getDate() - 3);
  const tx     = new BorrowTransaction(104, 1, 10, new Date(), pastDue);
  const status = tx.checkOverdueStatus();
  assert(status.isOverdue === true, "Should be overdue");
  assert(status.daysOverdue === 3, "Should be 3 days overdue");
  assert(status.projectedFine === 15, "Should be ₱15");
});

test("checkOverdueStatus returns false for active non-overdue", () => {
  const futureDue = new Date();
  futureDue.setDate(futureDue.getDate() + 5);
  const tx     = new BorrowTransaction(105, 1, 10, new Date(), futureDue);
  const status = tx.checkOverdueStatus();
  assert(status.isOverdue === false);
  assert(status.daysOverdue === 0);
});

// ══════════════════════════════════════════════════════════════════════════════
//  SECTION 8 — Reservation
// ══════════════════════════════════════════════════════════════════════════════
section("8. Reservation — Create, Cancel, Fulfil, Expiry");

test("reserve() assigns reservationID via mock DB", async () => {
  const r = new Reservation(null, 1, 10);
  await r.reserve(mockDB);
  assert(r.reservationID !== null, "reservationID should be assigned");
  assert(r.status === "pending", "Status should be pending");
});

test("Expiry date is 3 days after reservation", () => {
  const r    = new Reservation(null, 1, 10);
  const diff = Math.round((r.expiryDate - r.reservedAt) / (1000 * 60 * 60 * 24));
  assert(diff === 3, `Expected 3-day hold, got ${diff}`);
});

test("cancel() sets status to cancelled", async () => {
  const r = new Reservation(200, 1, 10, null, null, null, new Date(), null, "pending");
  await r.cancel(mockDB);
  assert(r.status === "cancelled");
});

test("cancel() throws if already fulfilled", async () => {
  const r = new Reservation(201, 1, 10, null, null, null, new Date(), null, "fulfilled");
  let threw = false;
  try { await r.cancel(mockDB); } catch { threw = true; }
  assert(threw, "Should throw on fulfilled reservation");
});

test("fulfil() sets status to fulfilled", async () => {
  const r = new Reservation(202, 1, 10, null, null, null, new Date(), null, "ready");
  await r.fulfil(mockDB);
  assert(r.status === "fulfilled");
});

test("fulfil() throws if not ready", async () => {
  const r = new Reservation(203, 1, 10, null, null, null, new Date(), null, "pending");
  let threw = false;
  try { await r.fulfil(mockDB); } catch { threw = true; }
  assert(threw, "Should throw if status is not ready");
});

test("isExpired returns true for overdue ready reservation", () => {
  const pastExpiry = new Date();
  pastExpiry.setDate(pastExpiry.getDate() - 1);
  const r = new Reservation(204, 1, 10, null, null, null, new Date(), pastExpiry, "ready");
  assert(r.isExpired() === true, "Should be expired");
});

test("isExpired returns false for future expiry", () => {
  const futureExpiry = new Date();
  futureExpiry.setDate(futureExpiry.getDate() + 2);
  const r = new Reservation(205, 1, 10, null, null, null, new Date(), futureExpiry, "ready");
  assert(r.isExpired() === false, "Should not be expired");
});

// ══════════════════════════════════════════════════════════════════════════════
//  SECTION 9 — Report
// ══════════════════════════════════════════════════════════════════════════════
section("9. Report — Query Builders & Export");

const REPORT_TYPES = ["borrowed", "overdue", "frequent", "payments"];

for (const type of REPORT_TYPES) {
  test(`_buildQuery("${type}") returns valid SQL`, () => {
    const r = new Report(null, type, 99);
    const { sql, values } = r._buildQuery({});
    assert(typeof sql === "string" && sql.length > 10, "SQL too short");
    assert(Array.isArray(values), "Values should be array");
    assert(sql.includes("SELECT"), "Should be a SELECT query");
  });
}

test("_buildQuery throws on invalid type", () => {
  const r = new Report(null, "unknown", 99);
  let threw = false;
  try { r._buildQuery(); } catch { threw = true; }
  assert(threw, "Should throw on unknown type");
});

test("export('csv') outputs correct headers and rows", () => {
  const r = new Report(1, "borrowed", 99);
  r.content = [
    { transaction_id: 1, member_name: "Alice", book_title: "Clean Code", status: "active" },
    { transaction_id: 2, member_name: "Bob",   book_title: "Refactoring", status: "overdue" },
  ];
  const csv   = r.export("csv");
  const lines = csv.split("\n");
  assert(lines[0] === "transaction_id,member_name,book_title,status", "Header mismatch");
  assert(lines.length === 3, "Should have header + 2 rows");
});

test("export('json') outputs valid JSON with metadata", () => {
  const r = new Report(1, "payments", 99);
  r.content = [{ payment_id: 1, member_name: "Alice", amount: 50 }];
  const json = JSON.parse(r.export("json"));
  assert(json.reportType === "payments", "reportType mismatch");
  assert(Array.isArray(json.data), "data should be an array");
  assert(json.data.length === 1, "Should have 1 row");
});

test("export throws when no content", () => {
  const r = new Report(1, "borrowed", 99);
  let threw = false;
  try { r.export("csv"); } catch { threw = true; }
  assert(threw, "Should throw with null content");
});

test("export throws on unsupported format", () => {
  const r = new Report(1, "borrowed", 99);
  r.content = [{ x: 1 }];
  let threw = false;
  try { r.export("pdf"); } catch { threw = true; }
  assert(threw, "Should throw on unsupported format");
});

test("getFilename includes type and date", () => {
  const r    = new Report(1, "overdue", 99);
  const name = r.getFilename("csv");
  assert(name.includes("overdue"), "Should include report type");
  assert(name.endsWith(".csv"), "Should end with .csv");
});

test("generate() with mock DB sets content to empty array", async () => {
  const r = new Report(null, "borrowed", 99);
  await r.generate(mockDB, {});
  assert(Array.isArray(r.content), "Content should be an array after generate");
});

// ══════════════════════════════════════════════════════════════════════════════
//  SECTION 10 — RBAC Middleware
// ══════════════════════════════════════════════════════════════════════════════
section("10. RBAC Middleware — authenticate, authorize, ownDataOnly");

let memberToken, librarianToken;

test("authenticate passes with valid Bearer token", () => {
  const m  = new Member(1, "alice", "alice@lib.com", "hash", "active");
  memberToken = m.generateToken();
  const req    = { headers: { authorization: `Bearer ${memberToken}` } };
  const res    = mockRes();
  let   called = false;
  authenticate(req, res, () => { called = true; });
  assert(called, "next() should be called");
  assert(req.user.role === "member", "req.user.role should be member");
});

test("authenticate rejects missing token", () => {
  const req = { headers: {} };
  const res = mockRes();
  authenticate(req, res, () => {});
  assert(res._status === 401, "Should return 401");
});

test("authenticate rejects tampered token", () => {
  const req = { headers: { authorization: "Bearer faketoken.abc.xyz" } };
  const res = mockRes();
  authenticate(req, res, () => {});
  assert(res._status === 401, "Should return 401");
});

test("authorize('librarian') blocks member", () => {
  const lib2 = new Librarian(99, "admin", "a@a.com", "hash", 1, "Main");
  librarianToken = lib2.generateToken();

  const req  = { headers: { authorization: `Bearer ${memberToken}` } };
  const res  = mockRes();
  authenticate(req, res, () => {});
  const middleware = authorize("librarian");
  middleware(req, res, () => {});
  assert(res._status === 403, "Member should be blocked from librarian route");
});

test("authorize('librarian') allows librarian", () => {
  const req    = { headers: { authorization: `Bearer ${librarianToken}` } };
  const res    = mockRes();
  let   called = false;
  authenticate(req, res, () => {});
  authorize("librarian")(req, res, () => { called = true; });
  assert(called, "Librarian should pass authorize check");
});

test("authorize('member','librarian') allows both roles", () => {
  for (const token of [memberToken, librarianToken]) {
    const req    = { headers: { authorization: `Bearer ${token}` } };
    const res    = mockRes();
    let   called = false;
    authenticate(req, res, () => {});
    authorize("member", "librarian")(req, res, () => { called = true; });
    assert(called, `Should allow token for ${req.user?.role}`);
  }
});

test("ownDataOnly allows member to access own data", () => {
  const req    = { headers: { authorization: `Bearer ${memberToken}` }, params: { memberID: "1" } };
  const res    = mockRes();
  let   called = false;
  authenticate(req, res, () => {});
  ownDataOnly("memberID")(req, res, () => { called = true; });
  assert(called, "Should allow own data access");
});

test("ownDataOnly blocks member from another member's data", () => {
  const req = { headers: { authorization: `Bearer ${memberToken}` }, params: { memberID: "99" } };
  const res = mockRes();
  authenticate(req, res, () => {});
  ownDataOnly("memberID")(req, res, () => {});
  assert(res._status === 403, "Should block cross-member access");
});

test("ownDataOnly allows librarian to access any member's data", () => {
  const req    = { headers: { authorization: `Bearer ${librarianToken}` }, params: { memberID: "999" } };
  const res    = mockRes();
  let   called = false;
  authenticate(req, res, () => {});
  ownDataOnly("memberID")(req, res, () => { called = true; });
  assert(called, "Librarian should bypass ownDataOnly");
});

// ══════════════════════════════════════════════════════════════════════════════
//  SECTION 11 — Payment & Notification (skip live API, validate structure)
// ══════════════════════════════════════════════════════════════════════════════
section("11. Payment & Notification — Structure Validation (no live API)");

test("Payment constructor sets all fields correctly", () => {
  const p = new Payment(1, 1, 150.0, "gcash", "fine");
  assert(p.amount === 150, "Amount mismatch");
  assert(p.method === "gcash", "Method mismatch");
  assert(p.status === "pending", "Should be pending");
  assert(p.type   === "fine", "Type should be fine");
});

test("Payment throws for unsupported method", async () => {
  const p = new Payment(null, 1, 50, "bitcoin", "fine");
  let threw = false;
  try { await p.processPayment(); } catch { threw = true; }
  assert(threw, "Should throw for unsupported method");
});

test("Payment throws for zero amount", async () => {
  const p = new Payment(null, 1, 0, "gcash", "fine");
  let threw = false;
  try { await p.processPayment(); } catch { threw = true; }
  assert(threw, "Should throw for 0 amount");
});

test("getConfirmation returns all expected fields", () => {
  const p      = new Payment(5, 2, 100, "paypal", "membership");
  p.status      = "confirmed";
  p.referenceID = "PAY-ABC123";
  const conf   = p.getConfirmation();
  assert(conf.paymentID   === 5, "paymentID mismatch");
  assert(conf.referenceID === "PAY-ABC123", "referenceID mismatch");
  assert(conf.status      === "confirmed", "status mismatch");
});

test("Notification has all 5 required templates", () => {
  const required = ["due_reminder", "overdue", "reservation_ready", "payment_confirmation", "membership_activated"];
  for (const type of required) {
    assert(Notification.TEMPLATES[type], `Missing template: ${type}`);
  }
});

test("Notification template renders valid HTML for each type", () => {
  const data = {
    memberName : "Alice",
    bookTitle  : "Clean Code",
    dueDate    : "May 1, 2026",
    daysOverdue: 3,
    fineAmount : 15,
    expiryDate : "April 30, 2026",
    amount     : 50,
    method     : "GCash",
    referenceID: "REF123",
    date       : "April 26, 2026",
  };
  for (const [type, fn] of Object.entries(Notification.TEMPLATES)) {
    const { subject, html } = fn(data);
    assert(typeof subject === "string" && subject.length > 0, `${type} subject is empty`);
    assert(html.includes("Alice"), `${type} HTML missing member name`);
  }
});

test("Notification constructor sets fields correctly", () => {
  const n = new Notification(1, "overdue", "alice@lib.com", "Alice", { daysOverdue: 3 });
  assert(n.type           === "overdue",       "type mismatch");
  assert(n.recipientEmail === "alice@lib.com", "email mismatch");
  assert(n.status         === "pending",       "status should be pending");
});

// ══════════════════════════════════════════════════════════════════════════════
//  FINAL SUMMARY
// ══════════════════════════════════════════════════════════════════════════════

// Wait for all async tests then print summary
setTimeout(() => {
  const total = passed + failed;
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  TEST RESULTS — JusBooks Class Tester`);
  console.log(`${"═".repeat(60)}`);
  console.log(`  Total : ${total}`);
  console.log(`  Passed: ${passed} ✅`);
  console.log(`  Failed: ${failed} ${failed > 0 ? "❌" : ""}`);
  console.log(`${"═".repeat(60)}`);

  if (failed > 0) {
    console.log("\n  Failed tests:");
    results.filter(r => r.status === "FAIL").forEach(r => {
      console.log(`  ❌ ${r.name}`);
      console.log(`     → ${r.error}`);
    });
  } else {
    console.log("\n  All tests passed! 🎉");
  }

  console.log(`\n  NOTE: Payment.processPayment() and Notification.send()`);
  console.log(`  require real API credentials — skipped in this tester.`);
  console.log(`  Wire PAYPAL_CLIENT_ID, PAYMONGO_SECRET_KEY, GMAIL_* env`);
  console.log(`  vars from .env.example to enable live API tests.\n`);
}, 1500);

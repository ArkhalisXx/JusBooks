module.exports = {
  User             : require("./models/User").User,
  Member           : require("./models/Member"),
  Librarian        : require("./models/Librarian"),
  Book             : require("./models/Book"),
  BorrowTransaction: require("./models/BorrowTransaction"),
  Fine             : require("./models/Fine"),
  Payment          : require("./models/Payment"),
  Reservation      : require("./models/Reservation"),
  Notification     : require("./models/Notification"),
  Report           : require("./models/Report"),
  // Middleware
  auth             : require("./middleware/auth"),
};

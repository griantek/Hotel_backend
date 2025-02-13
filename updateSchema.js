const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('hotel.db');

db.run(`ALTER TABLE bookings ADD COLUMN selected_id_type TEXT`, err => {
  if (err) {
    console.error('Error adding column:', err);
  } else {
    console.log('Successfully added selected_id_type column');
  }
  db.close();
});

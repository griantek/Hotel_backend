const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('hotel.db');

// Add new columns for ID verification
db.serialize(() => {
  // Add id_image_url to bookings table
  db.run(`ALTER TABLE bookings ADD COLUMN id_image_url TEXT`, err => {
    if (err && !err.message.includes('duplicate')) {
      console.error('Error adding id_image_url column:', err);
    } else {
      console.log('Successfully added id_image_url column');
    }
  });

  // Create verified_ids table
  db.run(`CREATE TABLE IF NOT EXISTS verified_ids (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id INTEGER NOT NULL,
    id_type TEXT NOT NULL,
    id_number TEXT,
    name TEXT,
    dob TEXT,
    verification_status TEXT DEFAULT 'pending',
    ocr_text TEXT,
    verification_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (booking_id) REFERENCES bookings(id)
  )`, err => {
    if (err) {
      console.error('Error creating verified_ids table:', err);
    } else {
      console.log('Successfully created verified_ids table');
    }
  });
});

db.close();

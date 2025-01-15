const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const cron = require('node-cron');
const moment = require('moment');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const db = new sqlite3.Database('hotel.db');

const WHATSAPP_API_URL = process.env.WHATSAPP_API_URL
const WHATSAPP_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN

async function sendWhatsAppMessage(phoneNumber, message) {
  try {
    await axios.post(WHATSAPP_API_URL, {
      messaging_product: "whatsapp",
      to: phoneNumber,
      type: "text",
      text: { body: message }
    }, {
      headers: {
        'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error sending WhatsApp message:', error);
  }
}

// Database tables remain the same
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    room_type TEXT NOT NULL,
    check_in_date TEXT NOT NULL,
    check_in_time TEXT NOT NULL,
    check_out_date TEXT NOT NULL,
    check_out_time TEXT NOT NULL,
    guest_count INTEGER NOT NULL,
    status TEXT DEFAULT 'confirmed',
    total_price REAL NOT NULL,
    paid_status TEXT DEFAULT 'unpaid',
    notes TEXT,
    FOREIGN KEY (user_id) REFERENCES users (id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    price REAL NOT NULL,
    availability INTEGER NOT NULL
  )`);
});

// Updated create booking endpoint with date-based pricing
app.post('/api/bookings', async (req, res) => {
  const { 
    name, 
    phone, 
    roomType, 
    checkInDate, 
    checkInTime, 
    checkOutDate, 
    checkOutTime, 
    guestCount,
    notes 
  } = req.body;

  db.serialize(async () => {
    try {
      // Calculate number of days based on dates only, ignoring time
      const checkIn = moment(checkInDate);
      const checkOut = moment(checkOutDate);
      const numberOfDays = checkOut.diff(checkIn, 'days') + 1; // Including both check-in and check-out days

      // Get room price per day
      db.get('SELECT price FROM rooms WHERE type = ?', [roomType], (err, room) => {
        if (err || !room) {
          return res.status(500).json({ error: 'Room type not found or database error' });
        }

        const totalPrice = room.price * numberOfDays;

        // Create or get the user
        db.get('SELECT id FROM users WHERE phone = ?', [phone], (err, user) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }

          let userId;
          if (!user) {
            db.run('INSERT INTO users (name, phone) VALUES (?, ?)', [name, phone], function(err) {
              if (err) {
                return res.status(500).json({ error: err.message });
              }
              userId = this.lastID;
              insertBooking(userId, totalPrice);
            });
          } else {
            userId = user.id;
            insertBooking(userId, totalPrice);
          }

          function insertBooking(userId, totalPrice) {
            db.run(
              `INSERT INTO bookings (
                user_id, room_type, check_in_date, check_in_time, 
                check_out_date, check_out_time, guest_count, total_price, notes
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [userId, roomType, checkInDate, checkInTime, checkOutDate, checkOutTime, guestCount, totalPrice, notes || null],
              async function(err) {
                if (err) {
                  return res.status(500).json({ error: err.message });
                }

                const confirmationMessage = `Thank you for your booking!\n\nDetails:\nRoom Type: ${roomType}\nCheck-in: ${checkInDate} ${checkInTime}\nCheck-out: ${checkOutDate} ${checkOutTime}\nGuests: ${guestCount}\nTotal Price: $${totalPrice.toFixed(2)} (${numberOfDays} day${numberOfDays > 1 ? 's' : ''})\n\nBooking ID: ${this.lastID}`;
                await sendWhatsAppMessage(phone, confirmationMessage);

                res.json({
                  message: 'Booking created successfully',
                  bookingId: this.lastID,
                  totalPrice: totalPrice,
                  numberOfDays: numberOfDays
                });
              }
            );
          }
        });
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
});

// Updated modify booking endpoint with date-based pricing
app.patch('/api/bookings/:id', async (req, res) => {
  const { 
    roomType, 
    checkInDate, 
    checkInTime, 
    checkOutDate, 
    checkOutTime, 
    guestCount,
    notes 
  } = req.body;
  const bookingId = req.params.id;

  db.serialize(async () => {
    try {
      // Get existing booking details
      db.get(
        `SELECT bookings.*, rooms.price AS roomPricePerDay, users.phone 
         FROM bookings 
         JOIN rooms ON bookings.room_type = rooms.type 
         JOIN users ON users.id = bookings.user_id 
         WHERE bookings.id = ?`,
        [bookingId],
        async (err, booking) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }

          if (!booking) {
            return res.status(404).json({ error: 'Booking not found' });
          }

          // Calculate number of days based on dates only
          const checkInDay = moment(checkInDate || booking.check_in_date);
          const checkOutDay = moment(checkOutDate || booking.check_out_date);
          const numberOfDays = checkOutDay.diff(checkInDay, 'days') + 1; // Including both check-in and check-out days

          const totalPrice = numberOfDays * booking.roomPricePerDay;

          // Check room availability with time
          db.get(
            `SELECT COUNT(*) as bookingCount, 
                    (SELECT availability FROM rooms WHERE type = ?) as totalRooms
             FROM bookings 
             WHERE room_type = ? 
               AND status = 'confirmed'
               AND (
                 (datetime(check_in_date || ' ' || check_in_time) <= datetime(? || ' ' || ?)
                  AND datetime(check_out_date || ' ' || check_out_time) > datetime(? || ' ' || ?))
                 OR 
                 (datetime(check_in_date || ' ' || check_in_time) < datetime(? || ' ' || ?)
                  AND datetime(check_out_date || ' ' || check_out_time) >= datetime(? || ' ' || ?))
               )`,
            [
              roomType || booking.room_type,
              roomType || booking.room_type,
              checkOutDate || booking.check_out_date,
              checkOutTime || booking.check_out_time,
              checkInDate || booking.check_in_date,
              checkInTime || booking.check_in_time,
              checkOutDate || booking.check_out_date,
              checkOutTime || booking.check_out_time,
              checkInDate || booking.check_in_date,
              checkInTime || booking.check_in_time
            ],
            (err, availability) => {
              if (err) {
                return res.status(500).json({ error: err.message });
              }

              if (availability.bookingCount >= availability.totalRooms) {
                return res.status(400).json({ error: 'Requested room type is not available for the selected dates and times' });
              }

              // Update booking
              db.run(
                `UPDATE bookings 
                 SET room_type = ?, 
                     check_in_date = ?, 
                     check_in_time = ?,
                     check_out_date = ?, 
                     check_out_time = ?,
                     guest_count = ?, 
                     total_price = ?,
                     notes = ?
                 WHERE id = ?`,
                [
                  roomType || booking.room_type,
                  checkInDate || booking.check_in_date,
                  checkInTime || booking.check_in_time,
                  checkOutDate || booking.check_out_date,
                  checkOutTime || booking.check_out_time,
                  guestCount || booking.guest_count,
                  totalPrice,
                  notes !== undefined ? notes : booking.notes,
                  bookingId,
                ],
                async function(err) {
                  if (err) {
                    return res.status(500).json({ error: err.message });
                  }

                  const modificationMessage = `Your booking has been modified!\n\nUpdated Details:\nRoom Type: ${roomType || booking.room_type}\nCheck-in: ${checkInDate || booking.check_in_date} ${checkInTime || booking.check_in_time}\nCheck-out: ${checkOutDate || booking.check_out_date} ${checkOutTime || booking.check_out_time}\nGuests: ${guestCount || booking.guest_count}\nTotal Price: $${totalPrice.toFixed(2)} (${numberOfDays} day${numberOfDays > 1 ? 's' : ''})\n\nBooking ID: ${bookingId}`;
                  
                  await sendWhatsAppMessage(booking.phone, modificationMessage);
                  res.json({
                    message: 'Booking modified successfully',
                    bookingId: bookingId,
                    numberOfDays: numberOfDays
                  });
                }
              );
            }
          );
        }
      );
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
});

// Rest of the code remains the same...
app.post('/api/rooms/availability', async (req, res) => {
  const { roomType, checkInDate, checkInTime, checkOutDate, checkOutTime } = req.body;

  db.serialize(() => {
    db.get(
      `SELECT COUNT(*) as bookingCount, 
              (SELECT availability FROM rooms WHERE type = ?) as totalRooms,
              (SELECT price FROM rooms WHERE type = ?) as roomPricePerDay
       FROM bookings 
       WHERE room_type = ? 
         AND status = 'confirmed'
         AND (
           (datetime(check_in_date || ' ' || check_in_time) <= datetime(? || ' ' || ?)
            AND datetime(check_out_date || ' ' || check_out_time) > datetime(? || ' ' || ?))
           OR 
           (datetime(check_in_date || ' ' || check_in_time) < datetime(? || ' ' || ?)
            AND datetime(check_out_date || ' ' || check_out_time) >= datetime(? || ' ' || ?))
         )`,
      [
        roomType, roomType, roomType,
        checkOutDate, checkOutTime,
        checkInDate, checkInTime,
        checkOutDate, checkOutTime,
        checkInDate, checkInTime
      ],
      (err, result) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
    
        const isAvailable = result.bookingCount < result.totalRooms;
        
        // Calculate number of days for price estimation
        const numberOfDays = moment(checkOutDate).diff(moment(checkInDate), 'days') + 1;
        const estimatedPrice = result.roomPricePerDay * numberOfDays;
        
        res.json({ 
          available: isAvailable,
          remainingRooms: result.totalRooms - result.bookingCount,
          roomPricePerDay: result.roomPricePerDay,
          estimatedTotalPrice: estimatedPrice,
          numberOfDays: numberOfDays
        });
      }
    );
  });
});

app.get('/api/bookings/:id', (req, res) => {
  const bookingId = req.params.id;

  db.get(
    `
    SELECT 
      b.id,
      b.room_type,
      b.check_in_date,
      b.check_in_time,
      b.check_out_date,
      b.check_out_time,
      b.guest_count,
      b.total_price,
      b.notes,
      u.name as guest_name,
      u.phone as guest_phone
    FROM bookings b
    JOIN users u ON b.user_id = u.id
    WHERE b.id = ?
    `,
    [bookingId],
    (err, booking) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (!booking) {
        return res.status(404).json({ error: 'Booking not found' });
      }
      res.json(booking);
    }
  );
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
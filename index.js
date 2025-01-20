const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const cron = require('node-cron');
const moment = require('moment');
const cors = require('cors');
const schedule = require('node-schedule');
require('dotenv').config();
const app = express();
app.use(express.json());
app.use(cors());
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const db = new sqlite3.Database('hotel.db');
const WHATSAPP_API_URL = process.env.WHATSAPP_API_URL
const WHATSAPP_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN

// time format
function formatTimeTo12Hour(time) {
  const [hour, minute] = time.split(':');
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const formattedHour = hour % 12 || 12;
  return `${formattedHour}:${minute} ${ampm}`;
}

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
    verification_status TEXT DEFAULT 'pending',
    room_number TEXT,
    notification_sent BOOLEAN DEFAULT 0,
    checkout_reminder_sent BOOLEAN DEFAULT 0,
    checkin_status TEXT DEFAULT 'pending',
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    price REAL NOT NULL,
    availability INTEGER NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id INTEGER NOT NULL,
    reminder_time TEXT NOT NULL,
    reminder_type TEXT NOT NULL, -- '24hr' or '1hr'
    FOREIGN KEY (booking_id) REFERENCES bookings (id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL -- Store hashed passwords
  )`); 
});

//Admin
app.post('/admin/login', async (req, res) => {
  const { username, password } = req.body;
  db.get('SELECT * FROM admins WHERE username = ?', [username], async (err, admin) => {
      if (err || !admin) return res.status(401).json({ error: 'Invalid username or password' });

      const isValidPassword = await bcrypt.compare(password, admin.password);
      if (!isValidPassword) return res.status(401).json({ error: 'Invalid username or password' });

      const token = jwt.sign({ id: admin.id }, process.env.JWT_SECRET, { expiresIn: '1h' });
      res.json({ token });
  });
});
// View users
app.get('/admin/users', authenticateAdmin, (req, res) => {
  db.all('SELECT * FROM users', (err, users) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(users);
  });
});

// View bookings

app.get('/admin/bookings', authenticateAdmin, (req, res) => {
  db.all(`
    SELECT 
      b.*,
      u.id as user_id,
      u.name as user_name,
      u.phone as user_phone
    FROM bookings b
    LEFT JOIN users u ON b.user_id = u.id
  `, (err, bookings) => {
    if (err) return res.status(500).json({ error: err.message });
    
    const formattedBookings = bookings.map(b => ({
      id: b.id,
      user: {
        id: b.user_id,
        name: b.user_name,
        phone: b.user_phone
      },
      room_type: b.room_type,
      check_in_date: b.check_in_date,
      check_in_time: b.check_in_time,
      check_out_date: b.check_out_date,
      check_out_time: b.check_out_time,
      guest_count: b.guest_count,
      total_price: b.total_price,
      status: b.status,
      paid_status: b.paid_status,
      notes: b.notes,
      checkin_status: b.checkin_status
    }));
    
    res.json(formattedBookings);
  });
});
//Manage rooms
// Fetch all rooms
app.get('/admin/rooms', authenticateAdmin, (req, res) => {
  db.all('SELECT * FROM rooms', (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to fetch rooms' });
    }
    res.json(rows);
  });
});
// Add a new room
app.post('/admin/rooms', authenticateAdmin, (req, res) => {
  const { type, price, availability } = req.body;

  if (!type || price === undefined || availability === undefined) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  db.run(
    `INSERT INTO rooms (type, price, availability) VALUES (?, ?, ?)`,
    [type, price, availability],
    function (err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to add room type' });
      }
      res.status(201).json({ message: 'Room type added successfully', id: this.lastID });
    }
  );
});
// Update a room type
app.patch('/admin/rooms/:id', authenticateAdmin, (req, res) => {
  const { id } = req.params;
  const { type, price, availability } = req.body;

  if (type === undefined && price === undefined && availability === undefined) {
    return res.status(400).json({ error: 'At least one field is required for update' });
  }

  const fieldsToUpdate = [];
  const values = [];

  if (type !== undefined) {
    fieldsToUpdate.push('type = ?');
    values.push(type);
  }
  if (price !== undefined) {
    fieldsToUpdate.push('price = ?');
    values.push(price);
  }
  if (availability !== undefined) {
    fieldsToUpdate.push('availability = ?');
    values.push(availability);
  }
  values.push(id);

  const query = `UPDATE rooms SET ${fieldsToUpdate.join(', ')} WHERE id = ?`;

  db.run(query, values, function (err) {
    if (err) {
      return res.status(500).json({ error: 'Failed to update room type' });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: 'Room type not found' });
    }
    res.json({ message: 'Room type updated successfully' });
  });
});

// Delete a room type
app.delete('/admin/rooms/:id', authenticateAdmin, (req, res) => {
  const { id } = req.params;

  db.run(`DELETE FROM rooms WHERE id = ?`, [id], function (err) {
    if (err) {
      return res.status(500).json({ error: 'Failed to delete room type' });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: 'Room type not found' });
    }
    res.json({ message: 'Room type deleted successfully' });
  });
});

// Send notification
app.post('/admin/notify', authenticateAdmin, async (req, res) => {
  const { phone, message } = req.body;
  try {
      await sendWhatsAppMessage(phone, message);
      res.json({ message: 'Notification sent successfully' });
  } catch (error) {
      res.status(500).json({ error: 'Failed to send notification' });
  }
});
// View statics
app.get('/admin/stats', authenticateAdmin, (req, res) => {
  const today = new Date().toISOString().split('T')[0];

  Promise.all([
    // Total bookings and revenue
    new Promise((resolve, reject) => {
      db.get(
        `SELECT 
         COUNT(*) as totalBookings,
         IFNULL(SUM(total_price), 0) as totalRevenue
         FROM bookings WHERE status = 'confirmed'`,
        (err, result) => {
          if (err) reject(err);
          else resolve(result);
        }
      );
    }),

    // Room stats and occupancy
    new Promise((resolve, reject) => {
      db.all(
        `SELECT 
         r.type,
         r.availability as total,
         (SELECT COUNT(*) FROM bookings b 
          WHERE b.room_type = r.type 
          AND b.status = 'confirmed'
          AND b.check_in_date <= ? 
          AND b.check_out_date > ?) as occupied
         FROM rooms r`,
        [today, today],
        (err, results) => {
          if (err) reject(err);
          else resolve(results);
        }
      );
    }),

    // Recent bookings
    new Promise((resolve, reject) => {
      db.all(
        `SELECT 
         b.id,
         u.name as guest_name,
         b.check_in_date,
         b.room_type as type,
         b.total_price,
         b.status
         FROM bookings b
         JOIN users u ON b.user_id = u.id
         ORDER BY b.created_at DESC
         LIMIT 10`,
        (err, results) => {
          if (err) reject(err);
          else resolve(results);
        }
      );
    })
  ])
    .then(([basicStats, roomResults, recentBookings]) => {
      const roomStats = {};
      let totalRooms = 0;
      let totalOccupied = 0;

      roomResults.forEach(({ type, total, occupied }) => {
        roomStats[type] = { total, occupied };
        totalRooms += total;
        totalOccupied += occupied;
      });

      const occupancyRate = totalRooms > 0 
        ? Math.round((totalOccupied / totalRooms) * 100) 
        : 0;

      res.json({
        totalBookings: basicStats.totalBookings,
        totalRevenue: basicStats.totalRevenue,
        occupancyRate,
        roomStats,
        recentBookings
      });
    })
    .catch(error => {
      res.status(500).json({ error: error.message });
    });
});
// Middleware to authenticate admin
function authenticateAdmin(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
      if (err) return res.status(403).json({ error: 'Forbidden' });
      req.adminId = decoded.id;
      next();
  });
}

// create booking endpoint with date-based pricing
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
      const numberOfDays = checkOut.diff(checkIn, 'days') ; // Including both check-in and check-out days

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

                const bookingId = this.lastID;
                // Create reminders
                createReminders(bookingId, checkInDate, checkInTime);

                const confirmationMessage = `Thank you for your booking!\n\nDetails:\nRoom Type: ${roomType}\nCheck-in: ${checkInDate} at ${formatTimeTo12Hour(checkInTime)}\nCheck-out: ${checkOutDate} at ${formatTimeTo12Hour(checkOutTime)}\nGuests: ${guestCount}\nTotal Price: $${totalPrice.toFixed(2)} (${numberOfDays} day${numberOfDays > 1 ? 's' : ''})\n\nBooking ID: ${this.lastID}`;
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

          // Calculate total price based on the new dates
          const checkInDay = moment(checkInDate || booking.check_in_date);
          const checkOutDay = moment(checkOutDate || booking.check_out_date);
          const numberOfDays = checkOutDay.diff(checkInDay, 'days'); // Including both check-in and check-out days
          const totalPrice = numberOfDays * booking.roomPricePerDay;

          // Update booking details
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
              // Delete old reminders
              db.run(`DELETE FROM reminders WHERE booking_id = ?`, [bookingId]);

              // Create new reminders
              createReminders(bookingId, checkInDate, checkInTime);

              const modificationMessage = `Your booking has been modified!\n\nUpdated Details:\nRoom Type: ${roomType || booking.room_type}\nCheck-in: ${checkInDate || booking.check_in_date} ${formatTimeTo12Hour(checkInTime) || formatTimeTo12Hour(booking.check_in_time)}\nCheck-out: ${checkOutDate || booking.check_out_date} ${formatTimeTo12Hour(checkOutTime) || formatTimeTo12Hour(booking.check_out_time)}\nGuests: ${guestCount || booking.guest_count}\nTotal Price: $${totalPrice.toFixed(2)} (${numberOfDays} day${numberOfDays > 1 ? 's' : ''})\n\nBooking ID: ${bookingId}`;
              
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
        const numberOfDays = moment(checkOutDate).diff(moment(checkInDate), 'days') ;
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

app.delete('/api/bookings/:id', (req, res) => {
  const bookingId = req.params.id;

  db.run(`UPDATE bookings SET status = 'cancelled' WHERE id = ?` , [bookingId], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    // Delete reminders
    db.run(`DELETE FROM reminders WHERE booking_id = ?`, [bookingId]);

    res.json({ message: 'Booking canceled successfully' });
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
      b.status,
      b.paid_status,
      b.total_price,
      b.verification_status,
      b.room_number,
      b.notes,
      b.checkin_status,
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

//create reminder
function createReminders(bookingId, checkInDate, checkInTime) {
  const checkInDateTime = moment(`${checkInDate}T${checkInTime}`);
  
  // Calculate reminder times
  const reminder24hr = checkInDateTime.clone().subtract(24, 'hours').format('YYYY-MM-DD HH:mm:ss');
  const reminder1hr = checkInDateTime.clone().subtract(1, 'hours').format('YYYY-MM-DD HH:mm:ss');

  db.run(`INSERT INTO reminders (booking_id, reminder_time, reminder_type) VALUES (?, ?, ?)`, 
    [bookingId, reminder24hr, '24hr']);
  db.run(`INSERT INTO reminders (booking_id, reminder_time, reminder_type) VALUES (?, ?, ?)`, 
    [bookingId, reminder1hr, '1hr']);
}
//send  reminder
cron.schedule('* * * * *', () => {
  const now = moment().add(5, 'hours').add(30, 'minutes').format('YYYY-MM-DD HH:mm:ss');
  console.log('Checking for reminders:', now);
  db.all(`SELECT reminders.*, bookings.room_type, bookings.check_in_date, bookings.check_in_time, users.phone 
          FROM reminders 
          JOIN bookings ON reminders.booking_id = bookings.id 
          JOIN users ON bookings.user_id = users.id 
          WHERE reminder_time <= ?`, [now], async (err, rows) => {
    if (err) {
      return console.error('Error fetching reminders:', err.message);
    }

    rows.forEach(async (reminder) => {
      const message = `Dear Customer, this is a friendly reminder that your booking for a ${reminder.room_type} on ${reminder.check_in_date} at ${formatTimeTo12Hour(reminder.check_in_time)}. We look forward to welcoming you!`;
      await sendWhatsAppMessage(reminder.phone, message);
      console.log('Reminder sent:', message);
      // Delete reminder after sending
      db.run(`DELETE FROM reminders WHERE id = ?`, [reminder.id]);
    });
  });
});

// Middleware to clean up expired tokens periodically
setInterval(() => {
  console.log(tokenStore)
  const now = Date.now();
  for (const token in tokenStore) {
    if (tokenStore[token].expiresAt < now) {
      delete tokenStore[token]; // Remove expired token
    }
  }  
}, 60000); // Run cleanup every minute

// Helper function to generate an 8-character random alphanumeric token
function generateSimpleToken() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let token = "";
  for (let i = 0; i < 8; i++) {
      token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}
// In-memory storage for tokens (key-value store: token -> phone)
const tokenStore = {};  
// Updated /generate-token
app.get("/generate-token", (req, res) => {
  const { phone, name, id } = req.query;
  
  try {
    const token = generateSimpleToken(); // Generate a token
    const expiresAt = Date.now() + 10 * 60 * 1000; // Set expiration time to 10 minutes from now
    tokenStore[token] = { phone, name, id, expiresAt }; // Store token with both phone and name
    console.log("token generated")
    console.log(tokenStore)
    res.json({ token });
    
  } catch (error) {
    console.error("Error generating token:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});
// Updated /validate-token
app.get("/validate-token", (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: "Token is required" });
  try {
    const data = tokenStore[token]; // Retrieve phone and name using token
    console.log("token retrieved")
    if (!data) throw new Error("Token not found");

    // Check if token is expired
    if (Date.now() > data.expiresAt) {
      delete tokenStore[token]; // Remove expired token
      throw new Error("Token has expired");
    }

    res.json(data); // Respond with phone and name
  } catch (error) {
    console.error("Invalid token:", error);
    console.log("token retrieved")
    res.status(401).json({ error: "Invalid or expired token" });
  }
});

// Admin endpoint with authentication
app.delete('/api/admin/bookings/:id', authenticateAdmin, async (req, res) => {
  const bookingId = req.params.id;

  try {
    // First get booking and user details for notification
    db.get(
      `SELECT b.*, u.phone 
       FROM bookings b
       JOIN users u ON b.user_id = u.id 
       WHERE b.id = ?`, 
      [bookingId],
      async (err, booking) => {
        if (err || !booking) {
          return res.status(404).json({ error: 'Booking not found' });
        }

        // Update status to cancelled
        db.run(
          `UPDATE bookings SET status = 'cancelled' WHERE id = ?`, 
          [bookingId], 
          async function(err) {
            if (err) return res.status(500).json({ error: err.message });
            
            // Delete reminders
            db.run(`DELETE FROM reminders WHERE booking_id = ?`, [bookingId]);
            
            // Send cancellation notification
            const message = `Your booking (ID: ${bookingId}) has been cancelled by admin.`;
            await sendWhatsAppMessage(booking.phone, message);

            res.json({ message: 'Booking cancelled successfully' });
          }
        );
      }
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update booking status (payment, verification, room)
app.patch('/api/admin/bookings/:id/update', authenticateAdmin, async (req, res) => {
  const bookingId = req.params.id;
  const updates = req.body;
  
  try {
    // First get the current booking and room details
    db.get(
      `SELECT b.*, r.price as room_price 
       FROM bookings b
       LEFT JOIN rooms r ON r.type = b.room_type
       WHERE b.id = ?`,
      [bookingId],
      async (err, booking) => {
        if (err || !booking) {
          return res.status(400).json({ error: 'Booking not found' });
        }

        // Calculate new total price if dates or room type changes
        if (updates.room_type || updates.check_in_date || updates.check_out_date) {
          const checkInDate = moment(updates.check_in_date || booking.check_in_date);
          const checkOutDate = moment(updates.check_out_date || booking.check_out_date);
          
          if (!checkInDate.isValid() || !checkOutDate.isValid() || checkOutDate.isSameOrBefore(checkInDate)) {
            return res.status(400).json({ error: 'Invalid date range' });
          }

          // Get room price
          const roomType = updates.room_type || booking.room_type;
          db.get('SELECT price FROM rooms WHERE type = ?', [roomType], async (err, room) => {
            if (err || !room) {
              return res.status(400).json({ error: 'Invalid room type' });
            }

            const numberOfDays = checkOutDate.diff(checkInDate, 'days');
            updates.total_price = room.price * numberOfDays;

            // Now process the update with new total price
            await processUpdate(updates);
          });
        } else {
          await processUpdate(updates);
        }
      }
    );

    async function processUpdate(updates) {
      const allowedFields = [
        'paid_status', 
        'verification_status', 
        'checkin_status',
        'room_number',
        'room_type',
        'status',
        'guest_count',
        'notes',
        'check_in_date',
        'check_in_time', 
        'check_out_date',
        'check_out_time',
        'total_price'
      ];

      const updateFields = [];
      const values = [];

      Object.entries(updates).forEach(([key, value]) => {
        if (allowedFields.includes(key) && value !== undefined) {
          updateFields.push(`${key} = ?`);
          values.push(value);
        }
      });

      if (updateFields.length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
      }

      values.push(bookingId);
      updateFields.push('updated_at = CURRENT_TIMESTAMP');

      db.run(
        `UPDATE bookings SET ${updateFields.join(', ')} WHERE id = ?`,
        values,
        function(err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ 
            message: 'Booking updated successfully',
            updatedFields: Object.keys(updates),
            totalPrice: updates.total_price
          });
        }
      );
    }

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// Helper function to check room availability
async function checkRoomAvailability(roomType, excludeBookingId) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT 
        (SELECT availability FROM rooms WHERE type = ?) as total_rooms,
        (SELECT COUNT(*) FROM bookings 
         WHERE room_type = ? AND status = 'confirmed' AND id != ?) as booked_rooms`,
      [roomType, roomType, excludeBookingId],
      (err, result) => {
        if (err) reject(err);
        resolve(result.total_rooms > result.booked_rooms);
      }
    );
  });
}

// Send reminder notification
app.post('/api/admin/bookings/:id/notify', authenticateAdmin, async (req, res) => {
  const bookingId = req.params.id;
  
  try {
    // Get booking details with user info
    db.get(
      `SELECT b.*, u.phone, u.name as guest_name
       FROM bookings b
       JOIN users u ON b.user_id = u.id
       WHERE b.id = ?`,
      [bookingId],
      async (err, booking) => {
        if (err || !booking) {
          return res.status(404).json({ error: 'Booking not found' });
        }

        const formattedTime = formatTimeTo12Hour(booking.check_in_time);
        const message = `Dear ${booking.guest_name}, this is a reminder for your booking check-in on ${booking.check_in_date} at ${formattedTime}. We look forward to welcoming you!`;
        
        try {
          await sendWhatsAppMessage(booking.phone, message);
          res.json({ message: 'Reminder sent successfully' });
        } catch (error) {
          console.error('WhatsApp notification error:', error);
          res.status(500).json({ error: 'Failed to send notification' });
        }
      }
    );
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add checkout reminder endpoint
app.post('/api/admin/bookings/:id/checkout-notify', authenticateAdmin, async (req, res) => {
  const bookingId = req.params.id;
  
  try {
    // Generate feedback token
    const feedbackToken = generateSimpleToken();
    const expiresAt = Date.now() + (24 * 60 * 60 * 1000); // 24 hours
    tokenStore[feedbackToken] = { bookingId, expiresAt };

    db.get(
      `SELECT b.*, u.phone, u.name as guest_name
       FROM bookings b
       JOIN users u ON b.user_id = u.id
       WHERE b.id = ?`,
      [bookingId],
      async (err, booking) => {
        if (err || !booking) {
          return res.status(404).json({ error: 'Booking not found' });
        }

        const feedbackUrl = `${process.env.WEB_APP_URL}/feedback?id=${feedbackToken}`;
        const message = `Dear ${booking.guest_name}, this is a reminder for your check-out today at ${formatTimeTo12Hour(booking.check_out_time)}. Please ensure timely check-out.\n\nWe'd love to hear your feedback: ${feedbackUrl}`;
        
        try {
          await sendWhatsAppMessage(booking.phone, message);
          
          // Update checkout reminder status
          db.run(
            `UPDATE bookings SET checkout_reminder_sent = 1 WHERE id = ?`,
            [bookingId]
          );

          res.json({ message: 'Checkout reminder sent successfully' });
        } catch (error) {
          res.status(500).json({ error: 'Failed to send notification' });
        }
      }
    );
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});
//Automatic cancellation
cron.schedule('0 0 * * *', () => {
  const yesterday = moment().subtract(1, 'days').format('YYYY-MM-DD');
  console.log('Running automatic cancellation task for bookings with check-in date:', yesterday);

  db.all(
    `SELECT b.id, b.check_in_date, u.phone, u.name 
     FROM bookings b
     JOIN users u ON b.user_id = u.id
     WHERE b.check_in_date = ? 
       AND b.status = 'confirmed' 
       AND b.checkin_status = 'pending'`,
    [yesterday],
    async (err, bookings) => {
      if (err) {
        return console.error('Error fetching bookings for cancellation:', err.message);
      }

      if (bookings.length === 0) {
        console.log('No bookings to cancel.');
        return;
      }

      for (const booking of bookings) {
        // Cancel booking
        db.run(
          `UPDATE bookings SET status = 'cancelled' WHERE id = ?`,
          [booking.id],
          async (err) => {
            if (err) {
              return console.error(`Error cancelling booking ID ${booking.id}:`, err.message);
            }

            console.log(`Booking ID ${booking.id} has been cancelled.`);

            // Notify user about the cancellation
            const message = `Dear ${booking.name}, your booking (ID: ${booking.id}) has been automatically cancelled because you did not check in on ${booking.check_in_date}. If you have any questions, please contact us.`;
            try {
              await sendWhatsAppMessage(booking.phone, message);
              console.log(`Notification sent to ${booking.phone} for booking ID ${booking.id}.`);
            } catch (notificationError) {
              console.error(`Error sending notification for booking ID ${booking.id}:`, notificationError);
            }
          }
        );
      }
    }
  );
});

const PORT =  4000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
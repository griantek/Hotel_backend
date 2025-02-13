const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const cron = require('node-cron');
const moment = require('moment-timezone');  // Update to moment-timezone
const cors = require('cors');
const schedule = require('node-schedule');
require('dotenv').config();
const app = express();
app.use(express.json());
app.use(cors());
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
const db = new sqlite3.Database('hotel.db');
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
const WHATSAPP_API_URL = process.env.WHATSAPP_API_URL
const WHATSAPP_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN

// Set default timezone
moment.tz.setDefault('Asia/Kolkata');

// Add root route
app.get('/', (req, res) => {
  res.json({
    message: "Welcome to Hotel Management API",
    status: "Server is running",
    timestamp: new Date().toISOString()
  });
});

// Configure multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/rooms/')
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`)
  }
});

const upload = multer({ storage });


// time format
function formatTimeTo12Hour(time) {
  const [hour, minute] = time.split(':');
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const formattedHour = hour % 12 || 12;
  return `${formattedHour}:${minute} ${ampm}`;
}

// Replace the existing sendWhatsAppMessage function
async function sendWhatsAppMessage(phoneNumber, messageData) {
  try {
    // Check if messageData is an interactive message object
    if (messageData.interactive) {
      // Send as interactive message
      await axios.post(WHATSAPP_API_URL, {
        messaging_product: "whatsapp",
        to: phoneNumber,
        type: "interactive",
        interactive: messageData.interactive
      }, {
        headers: {
          'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });
    } else {
      // Send as simple text message
      await axios.post(WHATSAPP_API_URL, {
        messaging_product: "whatsapp",
        to: phoneNumber,
        type: "text",
        text: {
          body: typeof messageData === 'string' ? messageData : messageData.text
        }
      }, {
        headers: {
          'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });
    }
  } catch (error) {
    console.error('Error sending WhatsApp message:', error.response?.data || error);
    throw error;
  }
}

// Add this function near other WhatsApp message functions
async function sendBookingConfirmation(phone, bookingData) {
    const {
        bookingId,
        roomType,
        checkInDate,
        checkInTime,
        checkOutDate,
        checkOutTime,
        guestCount,
        totalPrice,
        numberOfDays
    } = bookingData;

    const message = {
        interactive: {
            type: "button",
            body: {
                text: `🎉 Thank you for choosing us! 🎉\n\n` +
                    `🌟 Booking Confirmation 🌟\n` +
                    `Here are the details of your reservation:\n\n` +
                    `🏨 Room Type: ${roomType}\n` +
                    `🗓️ Check-in: ${checkInDate} at ${formatTimeTo12Hour(checkInTime)}\n` +
                    `🗓️ Check-out: ${checkOutDate} at ${formatTimeTo12Hour(checkOutTime)}\n` +
                    `👥 Guests: ${guestCount}\n` +
                    `💵 Total Price: $${totalPrice.toFixed(2)} (${numberOfDays} day${numberOfDays > 1 ? 's' : ''})\n` +
                    `📌 Booking ID: ${bookingId}\n\n` +
                    `📝 Check-in Instructions:\n` +
                    `1. Arrive at your check-in time\n` +
                    `2. Click the button below when you arrive\n` +
                    `3. Select and upload a valid photo ID\n` +
                    `4. Complete payment if pending\n` +
                    `5. Collect your room key from reception\n\n` +
                    `We're excited to host you! If you need any assistance, feel free to reach out. 😊`
            },
            action: {
                buttons: [
                    {
                        type: "reply",
                        reply: {
                            id: "start_checkin",
                            title: "Start Check-in"
                        }
                    },
                    {
                        type: "reply",
                        reply: {
                            id: "view_booking",
                            title: "View Booking"
                        }
                    }
                ]
            }
        }
    };

    await sendWhatsAppMessage(phone, message);
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
    selected_id_type TEXT,
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

  db.run(`CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id INTEGER NOT NULL,
    rating INTEGER NOT NULL,
    feedback TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (booking_id) REFERENCES bookings (id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS room_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL,
    photo_url TEXT NOT NULL,
    is_primary BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (room_id) REFERENCES rooms (id)
)`);

  db.run(`CREATE TABLE IF NOT EXISTS hotel_services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    price REAL,
    availability BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS service_schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_category TEXT NOT NULL,
    service_name TEXT NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    message_template TEXT NOT NULL,
    active BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS service_reminders_sent (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id INTEGER NOT NULL,
    service_id INTEGER NOT NULL,
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (booking_id) REFERENCES bookings(id),
    FOREIGN KEY (service_id) REFERENCES service_schedules(id)
  )`);

  // Insert default services if not exists
  db.get('SELECT COUNT(*) as count FROM hotel_services', [], (err, row) => {
    if (row.count === 0) {
      const defaultServices = [
        ['Room Service', 'In-Room Dining', '24/7 food and beverage service to your room', null, 1],
        ['Room Service', 'Mini Bar Restock', 'Replenishment of mini bar items', null, 1],
        ['Housekeeping', 'Room Cleaning', 'Daily room cleaning service', null, 1],
        ['Housekeeping', 'Laundry Service', 'Same-day laundry and dry cleaning', null, 1],
        ['Amenities', 'Swimming Pool', 'Access to pool facilities', null, 1],
        ['Amenities', 'Gym Access', '24/7 fitness center access', null, 1],
        ['Amenities', 'Spa Services', 'Massage and wellness treatments', null, 1],
        ['Concierge', 'Tour Booking', 'Local tour arrangements', null, 1],
        ['Concierge', 'Transportation', 'Airport transfers and local transport', null, 1]
      ];

      const stmt = db.prepare(`INSERT INTO hotel_services 
        (category, name, description, price, availability) VALUES (?, ?, ?, ?, ?)`);
      defaultServices.forEach(service => stmt.run(service));
      stmt.finalize();
    }
  });
});

//Admin
app.post('/admin/login', async (req, res) => {
  const { username, password } = req.body;
  console.log('🔐 Login attempt:', { username, timestamp: new Date().toISOString() });

  try {
    db.get('SELECT * FROM admins WHERE username = ?', [username], async (err, admin) => {
      if (err) {
        console.error('❌ Database error during login:', err);
        return res.status(500).json({ error: 'Internal server error' });
      }

      if (!admin) {
        console.log('❌ Login failed: Invalid username -', username);
        return res.status(401).json({ error: 'Invalid username or password' });
      }

      const isValidPassword = await bcrypt.compare(password, admin.password);
      
      if (!isValidPassword) {
        console.log('❌ Login failed: Invalid password for user -', username);
        return res.status(401).json({ error: 'Invalid username or password' });
      }

      const token = jwt.sign({ id: admin.id }, process.env.JWT_SECRET, { expiresIn: '1h' });
      console.log('✅ Login successful:', {
        username,
        adminId: admin.id,
        timestamp: new Date().toISOString()
      });
      
      res.json({ token });
    });
  } catch (error) {
    console.error('❌ Unexpected error during login:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add admin registration endpoint
app.post('/admin/register', async (req, res) => {
  const { username, password } = req.body;
  console.log('👤 Admin registration attempt:', { username, timestamp: new Date().toISOString() });

  try {
    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Insert into database
    db.run(
      'INSERT INTO admins (username, password) VALUES (?, ?)',
      [username, hashedPassword],
      function(err) {
        if (err) {
          console.error('❌ Admin registration failed:', err);
          return res.status(400).json({ error: 'Username already exists or database error' });
        }
        
        console.log('✅ Admin registered successfully:', { username, id: this.lastID });
        res.status(201).json({ message: 'Admin created successfully', id: this.lastID });
      }
    );
  } catch (error) {
    console.error('❌ Unexpected error during admin registration:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
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
  db.all(
    `SELECT 
      r.*,
      json_group_array(
        json_object(
          'id', rp.id,
          'photo_url', rp.photo_url,
          'is_primary', rp.is_primary
        )
      ) as photos
     FROM rooms r
     LEFT JOIN room_photos rp ON r.id = rp.room_id
     GROUP BY r.id`,
    (err, rooms) => {
      if (err) return res.status(500).json({ error: err.message });
      rooms = rooms.map(room => ({
        ...room,
        photos: JSON.parse(room.photos)
      }));
      res.json(rooms);
    }
  );
});
// Add a new room
// Add/Update room endpoint
app.post('/admin/rooms', authenticateAdmin, upload.array('photos', 5), async (req, res) => {
  const { type, price, availability } = req.body;
  
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    try {
      db.run(
        `INSERT INTO rooms (type, price, availability) VALUES (?, ?, ?)`,
        [type, price, availability],
        function(err) {
          if (err) throw err;
          
          const roomId = this.lastID;
          
          // Insert photos
          if (req.files) {
            req.files.forEach((file, index) => {
              db.run(
                `INSERT INTO room_photos (room_id, photo_url, is_primary) 
                 VALUES (?, ?, ?)`,
                [roomId, `/uploads/rooms/${file.filename}`, index === 0]
              );
            });
          }

          db.run('COMMIT');
          res.status(201).json({ message: 'Room added successfully', id: roomId });
        }
      );
    } catch (err) {
      db.run('ROLLBACK');
      res.status(500).json({ error: err.message });
    }
  });
});
// Update a room type
app.patch('/admin/rooms/:id', authenticateAdmin, upload.array('photos', 5), (req, res) => {
  const { id } = req.params;
  const { type, price, availability } = req.body;
  const photos = req.files;

  db.serialize(() => {
    db.run('BEGIN TRANSACTION');

    try {
      // Update room details
      if (type || price || availability) {
        const fieldsToUpdate = [];
        const values = [];

        if (type) {
          fieldsToUpdate.push('type = ?');
          values.push(type);
        }
        if (price) {
          fieldsToUpdate.push('price = ?');
          values.push(price);
        }
        if (availability) {
          fieldsToUpdate.push('availability = ?');
          values.push(availability);
        }
        values.push(id);

        db.run(
          `UPDATE rooms SET ${fieldsToUpdate.join(', ')} WHERE id = ?`,
          values
        );
      }
      // Handle photo uploads
      if (photos && photos.length > 0) {
        // Delete existing photos if needed
        if (req.body.replacePhotos === 'true') {
          db.run('DELETE FROM room_photos WHERE room_id = ?', [id]);
        }

        // Insert new photos
        photos.forEach((photo, index) => {
          db.run(
            `INSERT INTO room_photos (room_id, photo_url, is_primary) 
             VALUES (?, ?, ?)`,
            [id, `/uploads/rooms/${photo.filename}`, index === 0]
          );
        });
      }

      db.run('COMMIT');
      res.json({ message: 'Room updated successfully' });
    } catch (err) {
      db.run('ROLLBACK');
      res.status(500).json({ error: err.message });
    }
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
  const { name, phone, roomType, checkInDate, checkInTime, checkOutDate, checkOutTime, guestCount, notes } = req.body;

  db.serialize(async () => {
    try {
      const checkIn = moment(checkInDate);
      const checkOut = moment(checkOutDate);
      const numberOfDays = checkOut.diff(checkIn, 'days');

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
              insertBooking(userId);
            });
          } else {
            userId = user.id;
            insertBooking(userId);
          }

          // Move insertBooking function inside the scope where it's used
          function insertBooking(userId) {
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
                createReminders(bookingId, checkInDate, checkInTime);
                
                // Send confirmation message
                await sendBookingConfirmation(phone, {
                  bookingId,
                  roomType,
                  checkInDate,
                  checkInTime,
                  checkOutDate,
                  checkOutTime,
                  guestCount,
                  totalPrice,
                  numberOfDays
                });

                res.json({
                  message: 'Booking created successfully',
                  bookingId: bookingId,
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
              const modificationMessage = `✨ Your booking has been successfully updated! ✨\n\n📌 Updated Reservation Details:\n🏨 Room Type: ${roomType || booking.room_type}\n🗓️ Check-in: ${checkInDate || booking.check_in_date} at ${formatTimeTo12Hour(checkInTime) || formatTimeTo12Hour(booking.check_in_time)}\n🗓️ Check-out: ${checkOutDate || booking.check_out_date} at ${formatTimeTo12Hour(checkOutTime) || formatTimeTo12Hour(booking.check_out_time)}\n👥 Guests: ${guestCount || booking.guest_count}\n💵 Total Price: $${totalPrice.toFixed(2)} (${numberOfDays} day${numberOfDays > 1 ? 's' : ''})\n\n📖 Booking ID: ${bookingId}\n\nWe’ve updated your booking as per your request and can’t wait to host you! If you need further assistance or have any questions, feel free to reach out to us anytime.\nLooking forward to welcoming you soon! 😊`;
              // Send modification notification              
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
  db.all(`SELECT reminders.*, bookings.room_type, bookings.check_in_date, bookings.check_in_time, users.phone , users.name
          FROM reminders 
          JOIN bookings ON reminders.booking_id = bookings.id 
          JOIN users ON bookings.user_id = users.id 
          WHERE reminder_time <= ?`, [now], async (err, rows) => {
    if (err) {
      return console.error('Error fetching reminders:', err.message);
    }

    rows.forEach(async (reminder) => {
      const message = `Hello ${reminder.name},\n\n🌟 Just a friendly reminder about your upcoming stay! 🌟\n\n🏨 Room Type: ${reminder.room_type}\n📅 Check-in Date: ${reminder.check_in_date}\n⏰ Check-in Time: ${formatTimeTo12Hour(reminder.check_in_time)}\n\nWe’re excited to welcome you and ensure your stay is nothing short of wonderful. If you have any special requests or questions, please feel free to reach out.\nSee you soon! 😊`;
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
            const message = `We regret to inform you that your booking (ID: ${bookingId}) has been cancelled by the admin. If you have any questions or need further assistance, please don't hesitate to contact us. We're here to help!`;
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
    // If check-in status is being updated to 'checked_in'
    if (updates.checkin_status === 'checked_in') {
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

          // Send welcome message with services
          await sendCheckinWelcomeMessage(booking.phone, booking.guest_name, booking.room_number);
        }
      );
    }

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

// Add helper function to send welcome message
// async function sendCheckinWelcomeMessage(phone, guestName, roomNumber) {
//   try {
//     // Get available services
//     const services = await new Promise((resolve, reject) => {
//       db.all(
//         `SELECT category, GROUP_CONCAT(name, ': ' || description) as services
//          FROM hotel_services
//          WHERE availability = 1
//          GROUP BY category`,
//         (err, rows) => {
//           if (err) reject(err);
//           resolve(rows);
//         }
//       );
//     });

//     // Format services message
//     let servicesText = "\n\nOur Available Services:";
//     services.forEach(category => {
//       servicesText += `\n\n*${category.category}*:\n`;
//       category.services.split(',').forEach(service => {
//         servicesText += `• ${service.trim()}\n`;
//       });
//     });

//     const welcomeMessage = 
//       `🎉 Welcome to your room ${guestName}! 🎉\n\n` +
//       `We're delighted to have you with us. Your room number is: *${roomNumber}*\n` +
//       `To request any service, simply type "services" in this chat.${servicesText}\n\n` +
//       `For immediate assistance, please contact our front desk by dialing *0* from your room phone.\n\n` +
//       `We hope you have a wonderful stay with us! 🌟`;

//     await sendWhatsAppMessage(phone, welcomeMessage);
//   } catch (error) {
//     console.error('Error sending welcome message:', error);
//   }
// }

async function sendCheckinWelcomeMessage(phone, guestName, roomNumber) {
  try {
      // Get meal times from database
      const mealTimes = await getMealTimes();
      let mealTimesText = "\nMeal Times:";
      const mealEmojis = { 'Breakfast': '🍳', 'Lunch': '🍽️', 'Dinner': '🍴' };
      
      mealTimes.forEach(meal => {
          const startTime = formatTimeTo12Hour(meal.start_time);
          const endTime = formatTimeTo12Hour(meal.end_time);
          mealTimesText += `\n${mealEmojis[meal.service_name] || ''} ${meal.service_name}: ${startTime}-${endTime}`;
      });

      const welcomeMessage = 
          `🎉 Welcome ${guestName}!\n\n` +
          `Your Room: *${roomNumber}*\n\n` +
          `Quick Guide:\n` +
          `• Type "services" - Request room service/amenities\n` +
          `• Type "menu" - View restaurant menu\n` +
          `• Type "help" - Get assistance\n` +
          `• Dial *0* - Contact front desk\n` +
          mealTimesText + `\n\n` +
          `We'll send you timely reminders for meals and other services. Enjoy your stay! 🌟`;

      await sendWhatsAppMessage(phone, welcomeMessage);
      
      // Schedule immediate service reminder if applicable
      await scheduleImmediateServiceReminder(phone, roomNumber);
  } catch (error) {
      console.error('Error sending welcome message:', error);
  }
}

// Add new function to check and send immediate service reminder
async function scheduleImmediateServiceReminder(phone, roomNumber) {
    const now = moment();
    const currentTime = now.format('HH:mm:ss');

    try {
        // Get current active service
        const activeService = await new Promise((resolve, reject) => {
            db.get(
                `SELECT * FROM service_schedules 
                 WHERE time(?) BETWEEN time(start_time) AND time(end_time)
                 AND active = 1`,
                [currentTime],
                (err, row) => {
                    if (err) reject(err);
                    resolve(row);
                }
            );
        });

        if (activeService) {
            // Get booking ID for the room
            const booking = await new Promise((resolve, reject) => {
                db.get(
                    `SELECT id FROM bookings 
                     WHERE room_number = ? 
                     AND checkin_status = 'checked_in'
                     AND status = 'confirmed'`,
                    [roomNumber],
                    (err, row) => {
                        if (err) reject(err);
                        resolve(row);
                    }
                );
            });

            // Check if reminder already sent
            const reminderSent = await checkReminderSent(booking.id, activeService.id);
            
            if (!reminderSent) {
                await sendWhatsAppMessage(phone, activeService.message_template);
                await recordReminderSent(booking.id, activeService.id);
            }
        }
    } catch (error) {
        console.error('Error scheduling immediate service reminder:', error);
    }
}

async function recordReminderSent(bookingId, serviceId) {
  return new Promise((resolve, reject) => {
      db.run(
          `INSERT INTO service_reminders_sent (booking_id, service_id) 
           VALUES (?, ?)`,
          [bookingId, serviceId],
          err => {
              if (err) reject(err);
              resolve();
          }
      );
  });
}
// Add helper functions for reminder tracking
async function checkReminderSent(bookingId, serviceId) {
  return new Promise((resolve, reject) => {
      db.get(
          `SELECT 1 FROM service_reminders_sent 
           WHERE booking_id = ? AND service_id = ?`,
          [bookingId, serviceId],
          (err, row) => {
              if (err) reject(err);
              resolve(!!row);
          }
      );
  });
}

async function getMealTimes() {
  return new Promise((resolve, reject) => {
      db.all(
          `SELECT service_name, 
                  time(start_time) as start_time, 
                  time(end_time) as end_time 
           FROM service_schedules 
           WHERE service_category = 'Food' 
           AND active = 1
           ORDER BY start_time`,
          (err, rows) => {
              if (err) reject(err);
              resolve(rows);
          }
      );
  });
}
// Add new endpoint to get room types
// Update room-types endpoint to include photos
// Fix the room-types endpoint
app.get('/api/room-types', (req, res) => {
  db.all(`
    SELECT 
      r.*,
      json_group_array(
        CASE WHEN rp.id IS NOT NULL
          THEN json_object(
            'id', rp.id,
            'photo_url', rp.photo_url,
            'is_primary', rp.is_primary
          )
          ELSE NULL
        END
      ) as photos
    FROM rooms r
    LEFT JOIN room_photos rp ON r.id = rp.room_id
    GROUP BY r.id`, 
    (err, rooms) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Failed to fetch room types' });
      }
      
      // Format the response
      const formattedRooms = rooms.map(room => ({
        ...room,
        photos: JSON.parse(room.photos).filter(photo => photo !== null)
      }));
      
      res.json(formattedRooms);
    });
});
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
        const message = `Hello ${booking.guest_name},\n\n✨ Just a friendly reminder about your upcoming stay with us! ✨\n\n📅 Check-in Date: ${booking.check_in_date}\n⏰ Time: ${formattedTime}\n\nWe’re excited to welcome you and ensure your stay is comfortable and memorable. If you have any questions or special requests, feel free to reach out to us anytime.\nLooking forward to seeing you soon! 😊`;      
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
        const message = `Hello ${booking.guest_name},\n\nJust a kind reminder that your check-out is scheduled for today at ${formatTimeTo12Hour(booking.check_out_time)}. We hope you enjoyed your stay with us!\n\n🌟 We value your feedback! 🌟\nPlease take a moment to share your experience: ${feedbackUrl}\n\nThank you for choosing us, and we hope to welcome you again soon!`;       
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
            const message = `Hello ${booking.name},\n\nWe regret to inform you that your booking (ID: ${booking.id}) has been automatically cancelled as we did not receive your check-in on ${booking.check_in_date}.\nIf this was unintentional or if you have any questions, please don’t hesitate to reach out to us. We’d be happy to assist you.\n\nThank you for considering us, and we hope to welcome you in the future!\n\nBest regards,`;
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

// Feedback submission endpoint
app.post('/api/feedback', async (req, res) => {
  const { rating, feedback, bookingId } = req.body;

  if (!rating || !bookingId) {
    return res.status(400).json({ message: 'Rating and booking ID are required' });
  }

  try {
    db.run(
      `INSERT INTO feedback (booking_id, rating, feedback) VALUES (?, ?, ?)`,
      [bookingId, rating, feedback],
      function(err) {
        if (err) {
          return res.status(500).json({ message: 'Failed to save feedback' });
        }
        res.json({ message: 'Feedback submitted successfully' });
      }
    );
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Add this endpoint in index.js
app.get('/admin/feedback', authenticateAdmin, (req, res) => {
  db.all(
    `SELECT 
      f.id,
      f.rating,
      f.feedback as comment,
      f.created_at,
      u.name as user_name,
      u.phone
     FROM feedback f
     JOIN bookings b ON f.booking_id = b.id
     JOIN users u ON b.user_id = u.id
     ORDER BY f.created_at DESC`,
    (err, feedback) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to fetch feedback' });
      }
      res.json(feedback);
    }
  );
});

// Modify the scheduler to run every minute and handle all time-based service reminders
cron.schedule('* * * * *', async function() {
  console.log('Running service reminder check:', moment().tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss'));
  
  const currentTime = moment().tz('Asia/Kolkata').format('HH:mm:00');
  
  try {
      // Get all active services for current time window
      const activeServices = await new Promise((resolve, reject) => {
          db.all(
              `SELECT * FROM service_schedules 
               WHERE (
                  -- Exact time match for start time
                  time(?) = time(start_time)
                  OR
                  -- Check if current time falls within any active service window for new check-ins
                  time(?) BETWEEN time(start_time) AND time(end_time)
               )
               AND active = 1`,
              [currentTime, currentTime],
              (err, rows) => {
                  if (err) reject(err);
                  resolve(rows);
              }
          );
      });

      if (activeServices && activeServices.length > 0) {
          console.log(`Found ${activeServices.length} active services`);
          
          // Get all currently checked-in guests
          const activeBookings = await new Promise((resolve, reject) => {
              db.all(
                  `SELECT b.id, b.room_number, b.check_in_date, u.phone, u.name as guest_name
                   FROM bookings b
                   JOIN users u ON b.user_id = u.id
                   WHERE b.checkin_status = 'checked_in'
                   AND b.status = 'confirmed'
                   AND b.check_out_date >= date('now')`,
                  [],
                  (err, rows) => {
                      if (err) reject(err);
                      resolve(rows);
                  }
              );
          });

          console.log(`Found ${activeBookings.length} active checked-in guests`);

          // Process each service for each active booking
          for (const service of activeServices) {
              for (const booking of activeBookings) {
                  try {
                      const isStartTime = moment(currentTime, 'HH:mm:ss')
                          .isSame(moment(service.start_time, 'HH:mm:ss'));
                      
                      const isNewCheckin = moment(booking.check_in_date).isSame(moment(), 'day') &&
                          moment(currentTime, 'HH:mm:ss')
                              .isBetween(
                                  moment(service.start_time, 'HH:mm:ss'),
                                  moment(service.end_time, 'HH:mm:ss')
                              );

                      // Check if reminder already sent today
                      const reminderSent = await checkReminderSentToday(booking.id, service.id);
                      
                      if (!reminderSent && (isStartTime || isNewCheckin)) {
                          // Send reminder
                          await sendWhatsAppMessage(
                              booking.phone, 
                              `Dear ${booking.guest_name}, ${service.message_template}`
                          );
                          
                          // Record the reminder
                          await recordReminderSent(booking.id, service.id);
                          
                          console.log(`Sent ${service.service_name} reminder to Room ${booking.room_number}`);
                      }
                  } catch (error) {
                      console.error(`Error processing reminder for booking ${booking.id}:`, error);
                  }
              }
          }
      }
  } catch (error) {
      console.error('Error in service reminder scheduler:', error);
  }
});

// Add new helper function to check if reminder was sent today
async function checkReminderSentToday(bookingId, serviceId) {
  return new Promise((resolve, reject) => {
      db.get(
          `SELECT 1 FROM service_reminders_sent 
           WHERE booking_id = ? 
           AND service_id = ?
           AND date(sent_at) = date('now')`,
          [bookingId, serviceId],
          (err, row) => {
              if (err) reject(err);
              resolve(!!row);
          }
      );
  });
}

const PORT =  4000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
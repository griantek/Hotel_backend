# Backend Code Documentation

## admin.js
This file is used to create an admin user in the database. It hashes the provided password and inserts the admin credentials into the `admins` table.

```javascript
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');

const db = new sqlite3.Database('hotel.db'); // Connect to your database
const saltRounds = 10;

const username = "admin";
const plainPassword = "1234";

bcrypt.hash(plainPassword, saltRounds, (err, hashedPassword) => {
    if (err) {
        console.error("Error hashing password:", err);
    } else {
        db.run(
            'INSERT INTO admins (username, password) VALUES (?, ?)', 
            [username, hashedPassword], 
            (err) => {
                if (err) {
                    console.error("Error inserting admin into database:", err);
                } else {
                    console.log("Admin created successfully!");
                }
                db.close(); // Close the database connection
            }
        );
    }
});

Bot.js
This file handles the WhatsApp bot functionality, including sending messages, handling incoming messages, and scheduling follow-ups.

Dependencies: Express, body-parser, sqlite3, axios, node-schedule, dotenv
Database: Connects to hotel.db
WhatsApp API Configuration: Uses environment variables for API URL and access token
Functions:
formatTimeTo12Hour(time): Formats time to 12-hour format
sendWhatsAppMessage(to, messageData): Sends a WhatsApp message
sendWhatsAppTextMessage(to, text): Sends a WhatsApp text message
handleIncomingMessage(phone, message, name): Handles incoming messages
sendInitialGreeting(phone, name, hasBookings): Sends initial greeting with buttons
handleButtonResponse(phone, name, interactive, user): Handles button responses
sendLocation(phone): Sends location information
generateBookingLink(phone, name): Generates a booking link
generateModifyLink(id): Generates a modify link
scheduleBookingFollowUp(phone): Schedules a follow-up message
getUserByPhone(phone): Retrieves user by phone number
checkUserBookings(userId): Checks if user has bookings
getUserBookings(userId): Retrieves user bookings
cancelBooking(userId): Cancels a booking
sendBookingDetails(phone, bookings): Sends booking details
sendCancellationConfirmation(phone): Sends cancellation confirmation
sendCancellationSuccess(phone): Sends cancellation success message
sendContactInfo(phone): Sends contact information
sendFollowUpMessage(phone): Sends follow-up message
index.js
This file handles the main backend functionality, including user and booking management, reminders, and admin authentication.

Dependencies: Express, sqlite3, axios, node-cron, moment, cors, node-schedule, dotenv, jwt, bcrypt

Database: Connects to hotel.db

Functions:

formatTimeTo12Hour(time): Formats time to 12-hour format
sendWhatsAppMessage(phoneNumber, message): Sends a WhatsApp message
createReminders(bookingId, checkInDate, checkInTime): Creates reminders for bookings
generateSimpleToken(): Generates a simple token
authenticateAdmin(req, res, next): Middleware to authenticate admin
Endpoints:

Admin:

POST /admin/login: Admin login
GET /admin/users: View users
GET /admin/bookings: View bookings
GET /admin/rooms: Fetch all rooms
POST /admin/rooms: Add a new room
PATCH /admin/rooms/:id: Update a room type
DELETE /admin/rooms/:id: Delete a room type
GET /admin/stats: View statistics
POST /api/admin/bookings/:id/notify: Send reminder notification
POST /api/admin/bookings/:id/checkout-notify: Send checkout reminder
DELETE /api/admin/bookings/:id: Cancel booking
PATCH /api/admin/bookings/:id/update: Update booking status
User:

POST /api/bookings: Create booking with date-based pricing
PATCH /api/bookings/:id: Modify booking with date-based pricing
POST /api/rooms/availability: Check room availability
DELETE /api/bookings/:id: Cancel booking
GET /api/bookings/:id: Get booking details
POST /api/feedback: Submit feedback
GET /generate-token: Generate token
GET /validate-token: Validate token
Reminders:

cron.schedule('* * * * *'): Check for reminders every minute
cron.schedule('0 0 * * *'): Automatic cancellation of bookings
Database Schema
users: Stores user information
bookings: Stores booking information
rooms: Stores room information
reminders: Stores reminders for bookings
admins: Stores admin credentials
feedback: Stores feedback from users
package.json
This file contains the dependencies and scripts for the backend project.

This documentation should help any developer understand the backend code and its structure.

;
Bot.js
This file handles the WhatsApp bot functionality, including sending messages, handling incoming messages, and scheduling follow-ups.

Dependencies: Express, body-parser, sqlite3, axios, node-schedule, dotenv
Database: Connects to hotel.db
WhatsApp API Configuration: Uses environment variables for API URL and access token
Functions:
formatTimeTo12Hour(time): Formats time to 12-hour format
sendWhatsAppMessage(to, messageData): Sends a WhatsApp message
sendWhatsAppTextMessage(to, text): Sends a WhatsApp text message
handleIncomingMessage(phone, message, name): Handles incoming messages
sendInitialGreeting(phone, name, hasBookings): Sends initial greeting with buttons
handleButtonResponse(phone, name, interactive, user): Handles button responses
sendLocation(phone): Sends location information
generateBookingLink(phone, name): Generates a booking link
generateModifyLink(id): Generates a modify link
scheduleBookingFollowUp(phone): Schedules a follow-up message
getUserByPhone(phone): Retrieves user by phone number
checkUserBookings(userId): Checks if user has bookings
getUserBookings(userId): Retrieves user bookings
cancelBooking(userId): Cancels a booking
sendBookingDetails(phone, bookings): Sends booking details
sendCancellationConfirmation(phone): Sends cancellation confirmation
sendCancellationSuccess(phone): Sends cancellation success message
sendContactInfo(phone): Sends contact information
sendFollowUpMessage(phone): Sends follow-up message
index.js
This file handles the main backend functionality, including user and booking management, reminders, and admin authentication.

Dependencies: Express, sqlite3, axios, node-cron, moment, cors, node-schedule, dotenv, jwt, bcrypt

Database: Connects to hotel.db

Functions:

formatTimeTo12Hour(time): Formats time to 12-hour format
sendWhatsAppMessage(phoneNumber, message): Sends a WhatsApp message
createReminders(bookingId, checkInDate, checkInTime): Creates reminders for bookings
generateSimpleToken(): Generates a simple token
authenticateAdmin(req, res, next): Middleware to authenticate admin
Endpoints:

Admin:

POST /admin/login: Admin login
GET /admin/users: View users
GET /admin/bookings: View bookings
GET /admin/rooms: Fetch all rooms
POST /admin/rooms: Add a new room
PATCH /admin/rooms/:id: Update a room type
DELETE /admin/rooms/:id: Delete a room type
GET /admin/stats: View statistics
POST /api/admin/bookings/:id/notify: Send reminder notification
POST /api/admin/bookings/:id/checkout-notify: Send checkout reminder
DELETE /api/admin/bookings/:id: Cancel booking
PATCH /api/admin/bookings/:id/update: Update booking status
User:

POST /api/bookings: Create booking with date-based pricing
PATCH /api/bookings/:id: Modify booking with date-based pricing
POST /api/rooms/availability: Check room availability
DELETE /api/bookings/:id: Cancel booking
GET /api/bookings/:id: Get booking details
POST /api/feedback: Submit feedback
GET /generate-token: Generate token
GET /validate-token: Validate token
Reminders:

cron.schedule('* * * * *'): Check for reminders every minute
cron.schedule('0 0 * * *'): Automatic cancellation of bookings
Database Schema
users: Stores user information
bookings: Stores booking information
rooms: Stores room information
reminders: Stores reminders for bookings
admins: Stores admin credentials
feedback: Stores feedback from users
package.json
This file contains the dependencies and scripts for the backend project.

This documentation should help any developer understand the backend code and its structure.

Similar code found with 3 license types - View matches
Sorry, the response hit the length limit. Please rephrase your prompt.
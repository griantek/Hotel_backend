// Required dependencies
const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
require('dotenv').config();
const app = express();
app.use(bodyParser.json());
const moment = require('moment');

// Database connection
const db = new sqlite3.Database('hotel.db');

// WhatsApp API configuration
const WHATSAPP_API_URL = `${process.env.WHATSAPP_API_URL}`;
const WHATSAPP_ACCESS_TOKEN = `${process.env.WHATSAPP_ACCESS_TOKEN}`;

// Helper function to send WhatsApp messages
async function sendWhatsAppMessage(to, messageData) {
    try {
        const response = await axios.post(
            `${WHATSAPP_API_URL}`,
            {
                messaging_product: "whatsapp",
                recipient_type: "individual",
                to: to,
                type: "interactive",
                ...messageData
            },
            {
                headers: {
                    'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        return response.data;
    } catch (error) {
        console.error('Error sending WhatsApp message:', error);
        throw error;
    }
}

async function sendWhatsAppTextMessage(to, text) {
    try {
        const response = await axios.post(
            `${WHATSAPP_API_URL}`,
            {
                messaging_product: "whatsapp",
                recipient_type: "individual",
                to: to,
                type: "text",
                text: {
                    body: text
                }
            },
            {
                headers: {
                    'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        return response.data;
    } catch (error) {
        console.error('Error sending WhatsApp message:', error);
        throw error;
    }
}

// Handle incoming admin messages
async function handleIncomingMessage(phone, message) {
    try {
        if (message.type === 'text' && message.text.body.toLowerCase() === 'hi') {
            await sendAdminMenu(phone);
        } else if (message.type === 'interactive') {
            await handleButtonResponse(phone, message.interactive);
        }
    } catch (error) {
        console.error('Error handling admin message:', error);
        await sendWhatsAppTextMessage(phone, 
            'Sorry, I encountered an error processing your request. Please try again or type "hi" to start over.'
        );
    }
}

// Send admin menu with enhanced options
async function sendAdminMenu(phone) {
    await sendWhatsAppMessage(phone, {
        interactive: {
            type: "list",
            header: {
                type: "text",
                text: "Admin Dashboard"
            },
            body: {
                text: "Select an option to manage the hotel system"
            },
            footer: {
                text: "Hotel Management System"
            },
            action: {
                button: "View Options",
                sections: [
                    {
                        title: "Bookings Management",
                        rows: [
                            {
                                id: "view_all_bookings",
                                title: "View All Bookings",
                                description: "See all current and upcoming bookings"
                            },
                            {
                                id: "today_checkins",
                                title: "Today's Check-ins",
                                description: "View today's expected check-ins"
                            },
                            {
                                id: "today_checkouts",
                                title: "Today's Check-outs",
                                description: "View today's expected check-outs"
                            },
                            {
                                id: "pending_verifications",
                                title: "Pending Verifications",
                                description: "View bookings pending verification"
                            }
                        ]
                    },
                    {
                        title: "Room Management",
                        rows: [
                            {
                                id: "room_status",
                                title: "Room Status",
                                description: "View current room occupancy"
                            },
                            {
                                id: "unpaid_bookings",
                                title: "Unpaid Bookings",
                                description: "View bookings with pending payments"
                            }
                        ]
                    },
                    {
                        title: "Reports & Feedback",
                        rows: [
                            {
                                id: "view_feedback",
                                title: "Customer Feedback",
                                description: "View recent customer feedback"
                            },
                            {
                                id: "occupancy_report",
                                title: "Occupancy Report",
                                description: "View current occupancy statistics"
                            }
                        ]
                    }
                ]
            }
        }
    });
}

// Enhanced database helper functions
async function getAllBookings() {
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT b.*, u.name as guest_name, u.phone as guest_phone 
             FROM bookings b 
             JOIN users u ON b.user_id = u.id 
             WHERE b.status = 'confirmed' 
             AND b.check_out_date >= date('now')
             ORDER BY b.check_in_date ASC`,
            [],
            (err, rows) => {
                if (err) reject(err);
                resolve(rows);
            }
        );
    });
}

async function getPendingVerifications() {
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT b.*, u.name as guest_name, u.phone as guest_phone 
             FROM bookings b 
             JOIN users u ON b.user_id = u.id 
             WHERE b.verification_status = 'pending' 
             AND b.check_in_date >= date('now')`,
            [],
            (err, rows) => {
                if (err) reject(err);
                resolve(rows);
            }
        );
    });
}

async function getUnpaidBookings() {
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT b.*, u.name as guest_name, u.phone as guest_phone 
             FROM bookings b 
             JOIN users u ON b.user_id = u.id 
             WHERE b.paid_status = 'unpaid' 
             AND b.check_in_date >= date('now')`,
            [],
            (err, rows) => {
                if (err) reject(err);
                resolve(rows);
            }
        );
    });
}

async function getRecentFeedback() {
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT f.*, b.room_type, u.name as guest_name
             FROM feedback f
             JOIN bookings b ON f.booking_id = b.id
             JOIN users u ON b.user_id = u.id
             ORDER BY f.created_at DESC LIMIT 10`,
            [],
            (err, rows) => {
                if (err) reject(err);
                resolve(rows);
            }
        );
    });
}

// Handle button responses with enhanced options
async function handleButtonResponse(phone, interactive) {
    const buttonId = interactive.button_reply?.id || interactive.list_reply?.id;
    
    if (!buttonId) {
        console.error('No valid button or list ID found in response:', interactive);
        await sendWhatsAppTextMessage(phone, 'Sorry, there was an error processing your request. Please try again.');
        return;
    }

    switch (buttonId) {
        case 'view_all_bookings':
            await sendAllBookings(phone);
            break;

        case 'today_checkins':
            await sendTodayCheckins(phone);
            break;

        case 'today_checkouts':
            await sendTodayCheckouts(phone);
            break;

        case 'pending_verifications':
            await sendPendingVerifications(phone);
            break;

        case 'room_status':
            await sendRoomStatus(phone);
            break;

        case 'unpaid_bookings':
            await sendUnpaidBookings(phone);
            break;

        case 'view_feedback':
            await sendRecentFeedback(phone);
            break;

        case 'occupancy_report':
            await sendOccupancyReport(phone);
            break;

        default:
            await sendWhatsAppTextMessage(phone, 'Invalid option selected. Please try again.');
            break;
    }
}

// Enhanced message sending functions
async function sendPendingVerifications(phone) {
    const pendingBookings = await getPendingVerifications();
    
    if (!pendingBookings.length) {
        await sendWhatsAppTextMessage(phone, "No bookings pending verification.");
        return;
    }

    const pendingList = pendingBookings.map(booking => 
        `🏨 Booking ID: ${booking.id}\n` +
        `👤 Guest: ${booking.guest_name}\n` +
        `📞 Phone: ${booking.guest_phone}\n` +
        `📅 Check-in: ${moment(booking.check_in_date).format('MMM DD, YYYY')}\n` +
        `🛏️ Room: ${booking.room_type}\n` +
        `💵 Amount: $${booking.total_price}\n` +
        `📝 Notes: ${booking.notes || 'None'}`
    ).join('\n-------------------\n');

    await sendWhatsAppTextMessage(phone, 
        `*Bookings Pending Verification*:\n\n${pendingList}`
    );
}

async function sendUnpaidBookings(phone) {
    const unpaidBookings = await getUnpaidBookings();
    
    if (!unpaidBookings.length) {
        await sendWhatsAppTextMessage(phone, "No unpaid bookings found.");
        return;
    }

    const unpaidList = unpaidBookings.map(booking => 
        `🏨 Booking ID: ${booking.id}\n` +
        `👤 Guest: ${booking.guest_name}\n` +
        `📞 Phone: ${booking.guest_phone}\n` +
        `📅 Check-in: ${moment(booking.check_in_date).format('MMM DD, YYYY')}\n` +
        `🛏️ Room: ${booking.room_type}\n` +
        `💵 Amount Due: $${booking.total_price}`
    ).join('\n-------------------\n');

    await sendWhatsAppTextMessage(phone, 
        `*Unpaid Bookings*:\n\n${unpaidList}`
    );
}

async function sendRecentFeedback(phone) {
    const feedback = await getRecentFeedback();
    
    if (!feedback.length) {
        await sendWhatsAppTextMessage(phone, "No feedback found.");
        return;
    }

    const feedbackList = feedback.map(f => 
        `⭐ Rating: ${f.rating}/5\n` +
        `👤 Guest: ${f.guest_name}\n` +
        `🛏️ Room: ${f.room_type}\n` +
        `💭 Comment: ${f.feedback || 'No comment'}\n` +
        `📅 Date: ${moment(f.created_at).format('MMM DD, YYYY')}`
    ).join('\n-------------------\n');

    await sendWhatsAppTextMessage(phone, 
        `*Recent Customer Feedback*:\n\n${feedbackList}`
    );
}

async function sendOccupancyReport(phone) {
    const rooms = await getRoomStatus();
    let totalRooms = 0;
    let occupiedRooms = 0;
    let revenue = 0;

    rooms.forEach(room => {
        totalRooms += room.availability;
        occupiedRooms += room.occupied;
        revenue += room.occupied * room.price;
    });

    const occupancyRate = ((occupiedRooms / totalRooms) * 100).toFixed(1);

    const report = 
        `📊 *Occupancy Report*\n\n` +
        `Total Rooms: ${totalRooms}\n` +
        `Occupied Rooms: ${occupiedRooms}\n` +
        `Occupancy Rate: ${occupancyRate}%\n` +
        `Today's Revenue: $${revenue.toFixed(2)}\n\n` +
        `*Breakdown by Room Type:*\n` +
        rooms.map(room => 
            `${room.type}: ${room.occupied}/${room.availability} (${((room.occupied/room.availability)*100).toFixed(1)}%)`
        ).join('\n');

    await sendWhatsAppTextMessage(phone, report);
}

// Export the message handling functionality
module.exports = {
    handleMessage: async (body) => {
        if (body.entry && 
            body.entry[0].changes && 
            body.entry[0].changes[0].value.messages && 
            body.entry[0].changes[0].value.messages[0]) {

            const incomingMessage = body.entry[0].changes[0].value.messages[0];
            const senderId = incomingMessage.from;
            const phone = senderId.replace('whatsapp:', '');
            
            await handleIncomingMessage(phone, incomingMessage);
        }
    }
};
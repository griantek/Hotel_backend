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
const WHATSAPP_API_URL = process.env.WHATSAPP_API_URL
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN

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
        // Verify if the user is an admin
        const isAdmin = await verifyAdmin(phone);
        if (!isAdmin) {
            await sendWhatsAppTextMessage(phone, 'Unauthorized access. This system is for admin use only.');
            return;
        }

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

// Verify admin status
async function verifyAdmin(phone) {
    return phone === process.env.ADMIN;
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
                        title: "Quick Actions",
                        rows: [
                            {
                                id: "dashboard_summary",
                                title: "Dashboard Summary",
                                description: "View today's key metrics"
                            },
                            {
                                id: "urgent_actions",
                                title: "Urgent Actions",
                                description: "View items needing immediate attention"
                            }
                        ]
                    },
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
                        title: "Reports & Analytics",
                        rows: [
                            {
                                id: "daily_revenue",
                                title: "Daily Revenue",
                                description: "View today's revenue metrics"
                            },
                            {
                                id: "occupancy_report",
                                title: "Occupancy Report",
                                description: "View occupancy statistics"
                            },
                            {
                                id: "feedback_summary",
                                title: "Feedback Summary",
                                description: "View recent customer feedback"
                            }
                        ]
                    }
                ]
            }
        }
    });
}

// Enhanced database helper functions
async function getDashboardSummary() {
    return new Promise((resolve, reject) => {
        const today = moment().format('YYYY-MM-DD');
        db.all(`
            SELECT 
                (SELECT COUNT(*) FROM bookings WHERE check_in_date = ?) as today_checkins,
                (SELECT COUNT(*) FROM bookings WHERE check_out_date = ?) as today_checkouts,
                (SELECT COUNT(*) FROM bookings WHERE paid_status = 'unpaid') as unpaid_bookings,
                (SELECT COUNT(*) FROM feedback WHERE created_at >= datetime('now', '-24 hours')) as new_feedback,
                (SELECT SUM(total_price) FROM bookings WHERE check_in_date = ?) as today_revenue
            `, [today, today, today],
            (err, rows) => {
                if (err) reject(err);
                resolve(rows[0]);
            }
        );
    });
}

async function getUrgentActions() {
    return new Promise((resolve, reject) => {
        const today = moment().format('YYYY-MM-DD');
        db.all(`
            SELECT 
                'Overdue Checkout' as action_type,
                b.id as booking_id,
                u.name as guest_name,
                b.room_type as room_type,
                b.room_number,
                b.check_out_date
            FROM bookings b
            JOIN users u ON b.user_id = u.id
            WHERE b.check_out_date < ? AND b.status = 'checked_in'
            UNION ALL
            SELECT 
                'Late Check-in' as action_type,
                b.id as booking_id,
                u.name as guest_name,
                b.room_number,
                b.check_in_date
            FROM bookings b
            JOIN users u ON b.user_id = u.id
            WHERE b.check_in_date = ? AND b.status = 'confirmed' AND b.checkin_status = 'pending'
            AND datetime('now', 'localtime') > time(b.check_in_time, '+2 hours')
        `, [today, today],
            (err, rows) => {
                if (err) reject(err);
                resolve(rows);
            }
        );
    });
}

async function getDailyRevenue() {
    return new Promise((resolve, reject) => {
        const today = moment().format('YYYY-MM-DD');
        db.all(`
            SELECT 
                SUM(total_price) as total_revenue,
                COUNT(*) as total_bookings,
                AVG(total_price) as average_booking_value,
                SUM(CASE WHEN paid_status = 'paid' THEN total_price ELSE 0 END) as collected_revenue,
                SUM(CASE WHEN paid_status = 'unpaid' THEN total_price ELSE 0 END) as pending_revenue
            FROM bookings
            WHERE check_in_date = ?
        `, [today],
            (err, rows) => {
                if (err) reject(err);
                resolve(rows[0]);
            }
        );
    });
}

// Handle button responses with enhanced options
async function handleButtonResponse(phone, interactive) {
    const buttonId = interactive.button_reply?.id || interactive.list_reply?.id;
    
    // Add service confirmation handling
    if (buttonId.startsWith('confirm_service_') || buttonId.startsWith('decline_service_')) {
        const [action, , serviceId, bookingId] = buttonId.split('_');
        await handleServiceResponse(action, serviceId, bookingId);
        return;
    }

    if (!buttonId) {
        console.error('No valid button or list ID found in response:', interactive);
        await sendWhatsAppTextMessage(phone, 'Sorry, there was an error processing your request. Please try again.');
        return;
    }

    try {
        switch (buttonId) {
            case 'dashboard_summary':
                await sendDashboardSummary(phone);
                break;

            case 'urgent_actions':
                await sendUrgentActions(phone);
                break;

            case 'view_all_bookings':
                await sendAllBookings(phone);
                break;

            case 'today_checkins':
                await sendTodayCheckins(phone);
                break;

            case 'today_checkouts':
                await sendTodayCheckouts(phone);
                break;

            case 'room_status':
                await sendRoomStatus(phone);
                break;

            case 'unpaid_bookings':
                await sendUnpaidBookings(phone);
                break;

            case 'daily_revenue':
                await sendDailyRevenue(phone);
                break;

            case 'occupancy_report':
                await sendOccupancyReport(phone);
                break;

            case 'feedback_summary':
                await sendFeedbackSummary(phone);
                break;

            default:
                await sendWhatsAppTextMessage(phone, 'Invalid option selected. Please try again.');
                break;
        }
    } catch (error) {
        console.error('Error handling button response:', error);
        await sendWhatsAppTextMessage(phone, 
            'Sorry, I encountered an error processing your request. Please try again.'
        );
    }
}

async function getServiceById(id) {
    return new Promise((resolve, reject) => {
        db.get(
            `SELECT * FROM hotel_services WHERE id = ?`,
            [id],
            (err, service) => {
                if (err) reject(err);
                resolve(service);
            }
        );
    });
}

// Add new helper function
async function handleServiceResponse(action, serviceId, bookingId) {
    try {
        const isConfirm = action === 'confirm';
        const status = isConfirm ? 'confirmed' : 'declined';

        // Get service and booking details
        const [service, booking] = await Promise.all([
            getServiceById(serviceId),
            getBookingById(bookingId)
        ]);

        // Update service request status
        await updateServiceRequest(serviceId, bookingId, status);

        // Get user's phone number
        const userPhone = await getUserPhone(booking.user_id);

        // Send response to user
        const message = serviceResponseMessages[service.category][action](service.name);
        await sendWhatsAppTextMessage(userPhone, message);

        // Confirm to admin
        await sendWhatsAppTextMessage(process.env.ADMIN,
            `${isConfirm ? '✅' : '❌'} ${service.category} request for Room ${booking.room_number} has been ${status}.`
        );

    } catch (error) {
        console.error('Error handling service response:', error);
    }
}

// Add these helper functions
async function updateServiceRequest(serviceId, bookingId, status) {
    return new Promise((resolve, reject) => {
        db.run(
            `UPDATE service_requests 
             SET status = ?, 
                 completed_at = CASE WHEN ? = 'confirmed' THEN CURRENT_TIMESTAMP ELSE NULL END
             WHERE service_id = ? AND booking_id = ?`,
            [status, status, serviceId, bookingId],
            (err) => {
                if (err) reject(err);
                resolve();
            }
        );
    });
}

// Enhanced message sending functions
async function sendDashboardSummary(phone) {
    const summary = await getDashboardSummary();
    const message = 
        `📊 *Dashboard Summary*\n\n` +
        `Today's Check-ins: ${summary.today_checkins}\n` +
        `Today's Check-outs: ${summary.today_checkouts}\n` +
        `Unpaid Bookings: ${summary.unpaid_bookings}\n` +
        `New Feedback: ${summary.new_feedback}\n` +
        `Today's Revenue: $${summary.today_revenue || 0}\n\n` +
        `For detailed reports, visit: ${process.env.ADMIN_DASHBOARD_URL}/dashboard`;

    await sendWhatsAppTextMessage(phone, message);
}

async function sendAllBookings(phone) {
    try {
        const bookings = await getAllBookings(); // Fetch bookings from the database
        if (bookings.length === 0) {
            await sendWhatsAppTextMessage(phone, "No bookings found.");
            return;
        }

        let message = "📌 *All Bookings List*\n\n";
        bookings.forEach((booking, index) => {
            message += `📅 Booking #${index + 1}\n`;
            message += `👤 Guest: ${booking.guest_name}\n`;
            message += `🏨 Room Type: ${booking.room_type}\n`;
            message += `🏨 Room No: ${booking.room_number}\n`;
            message += `📆 Check-in: ${booking.check_in_date}\n`;
            message += `📆 Check-out: ${booking.check_out_date}\n`;
            message += `💵 Status: ${booking.paid_status}\n`;
            message += "-------------------\n";
        });

        await sendWhatsAppTextMessage(phone, message);
    } catch (error) {
        console.error("Error sending all bookings:", error);
        await sendWhatsAppTextMessage(phone, "Failed to retrieve bookings. Please try again later.");
    }
}

async function getAllBookings() {
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT b.id, u.name as guest_name, b.room_type, b.room_number, b.check_in_date, b.check_out_date, b.paid_status
            FROM bookings b
            JOIN users u ON b.user_id = u.id
            ORDER BY b.check_in_date DESC`, 
            (err, rows) => {
                if (err) reject(err);
                resolve(rows);
            }
        );
    });
}

async function sendUrgentActions(phone) {
    const actions = await getUrgentActions();
    
    if (!actions.length) {
        await sendWhatsAppTextMessage(phone, "No urgent actions required at this time.");
        return;
    }

    const actionsList = actions.map(action => 
        `⚠️ ${action.action_type}\n` +
        `👤 Guest: ${action.guest_name}\n` +
        `🏨 Room Type: ${action.room_type}\n` +
        `🏨 Room No: ${action.room_number}\n` +
        `📅 Date: ${moment(action.check_out_date || action.check_in_date).format('MMM DD, YYYY')}`
    ).join('\n-------------------\n');

    await sendWhatsAppTextMessage(phone, 
        `*Urgent Actions Required*:\n\n${actionsList}\n\n` +
        `Take action at: ${process.env.ADMIN_DASHBOARD_URL}/urgent-actions`
    );
}

async function sendDailyRevenue(phone) {
    const revenue = await getDailyRevenue();
    const message = 
        `💰 *Daily Revenue Report*\n\n` +
        `Total Revenue: $${revenue.total_revenue || 0}\n` +
        `Total Bookings: ${revenue.total_bookings || 0}\n` +
        `Average Booking Value: $${Math.round(revenue.average_booking_value || 0)}\n` +
        `Collected Revenue: $${revenue.collected_revenue || 0}\n` +
        `Pending Revenue: $${revenue.pending_revenue || 0}\n\n` +
        `View detailed reports at: ${process.env.ADMIN_DASHBOARD_URL}/revenue`;

    await sendWhatsAppTextMessage(phone, message);
}

async function sendTodayCheckins(phone) {
    try {
        const todayCheckins = await getTodayCheckins(); // Fetch today's check-ins from the database
        if (todayCheckins.length === 0) {
            await sendWhatsAppTextMessage(phone, "No check-ins scheduled for today.");
            return;
        }

        let message = "📌 *Today's Check-ins*\n\n";
        todayCheckins.forEach((checkin, index) => {
            message += `📅 Check-in #${index + 1}\n`;
            message += `👤 Guest: ${checkin.guest_name}\n`;
            message += `🏨 Room No: ${checkin.room_number}\n`;
            message += `🕒 Check-in Time: ${checkin.check_in_time}\n`;
            message += "-------------------\n";
        });

        await sendWhatsAppTextMessage(phone, message);
    } catch (error) {
        console.error("Error sending today's check-ins:", error);
        await sendWhatsAppTextMessage(phone, "Failed to retrieve today's check-ins. Please try again later.");
    }
}

async function getTodayCheckins() {
    return new Promise((resolve, reject) => {
        const today = moment().format('YYYY-MM-DD');
        db.all(
            `SELECT b.id, u.name as guest_name, b.room_number, b.check_in_time
            FROM bookings b
            JOIN users u ON b.user_id = u.id
            WHERE b.check_in_date = ? AND b.status = 'confirmed'`,
            [today],
            (err, rows) => {
                if (err) reject(err);
                resolve(rows);
            }
        );
    });
}

async function sendTodayCheckouts(phone) {
    try {
        const todayCheckouts = await getTodayCheckouts(); // Fetch today's check-outs from the database
        if (todayCheckouts.length === 0) {
            await sendWhatsAppTextMessage(phone, "No check-outs scheduled for today.");
            return;
        }

        let message = "📌 *Today's Check-outs*\n\n";
        todayCheckouts.forEach((checkout, index) => {
            message += `📅 Check-out #${index + 1}\n`;
            message += `👤 Guest: ${checkout.guest_name}\n`;
            message += `🏨 Room No: ${checkout.room_number}\n`;
            message += `🕒 Check-out Time: ${checkout.check_out_time}\n`;
            message += "-------------------\n";
        });

        await sendWhatsAppTextMessage(phone, message);
    } catch (error) {
        console.error("Error sending today's check-outs:", error);
        await sendWhatsAppTextMessage(phone, "Failed to retrieve today's check-outs. Please try again later.");
    }
}

async function getTodayCheckouts() {
    return new Promise((resolve, reject) => {
        const today = moment().format('YYYY-MM-DD');
        db.all(
            `SELECT b.id, u.name as guest_name, b.room_number, b.check_out_time
            FROM bookings b
            JOIN users u ON b.user_id = u.id
            WHERE b.check_out_date = ? AND b.status = 'checked_in'`,
            [today],
            (err, rows) => {
                if (err) reject(err);
                resolve(rows);
            }
        );
    });
}

async function sendRoomStatus(phone) {
    try {
        const roomStatus = await getRoomStatus(); // Fetch current room status from the database
        if (roomStatus.length === 0) {
            await sendWhatsAppTextMessage(phone, "No room status data available.");
            return;
        }

        let message = "📌 *Room Status*\n\n";
        roomStatus.forEach((room, index) => {
            message += `🛏️ Type: ${room.type}\n`;
            message += `👤 Availability: ${room.availability}\n`;
            message += `💵 Price: $${room.price}\n`;
            message += "-------------------\n";
        });

        await sendWhatsAppTextMessage(phone, message);
    } catch (error) {
        console.error("Error sending room status:", error);
        await sendWhatsAppTextMessage(phone, "Failed to retrieve room status. Please try again later.");
    }
}

async function getRoomStatus() {
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT type, price, availability
            FROM rooms
            ORDER BY price ASC`,
            (err, rows) => {
                if (err) reject(err);
                resolve(rows);
            }
        );
    });
}

async function sendUnpaidBookings(phone) {
    try {
        const unpaidBookings = await getUnpaidBookings(); // Fetch unpaid bookings from the database
        if (unpaidBookings.length === 0) {
            await sendWhatsAppTextMessage(phone, "No unpaid bookings at the moment.");
            return;
        }

        let message = "📌 *Unpaid Bookings List*\n\n";
        unpaidBookings.forEach((booking, index) => {
            message += `📅 Booking #${index + 1}\n`;
            message += `👤 Guest: ${booking.guest_name}\n`;
            message += `🏨 Room Type: ${booking.room_type}\n`;
            message += `🏨 Room No: ${booking.room_number}\n`;
            message += `📆 Check-in: ${booking.check_in_date}\n`;
            message += `📆 Check-out: ${booking.check_out_date}\n`;
            message += `💵 Amount: $${booking.total_price}\n`;
            message += `⚠️ Status: Pending Payment\n`;
            message += "-------------------\n";
        });

        await sendWhatsAppTextMessage(phone, message);
    } catch (error) {
        console.error("Error sending unpaid bookings:", error);
        await sendWhatsAppTextMessage(phone, "Failed to retrieve unpaid bookings. Please try again later.");
    }
}

async function getUnpaidBookings() {
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT b.id, u.name as guest_name, b.room_type, b.room_number, b.check_in_date, b.check_out_date, b.total_price
            FROM bookings b
            JOIN users u ON b.user_id = u.id
            WHERE b.paid_status = 'unpaid'
            ORDER BY b.check_in_date DESC`,
            (err, rows) => {
                if (err) reject(err);
                resolve(rows);
            }
        );
    });
}

async function sendOccupancyReport(phone) {
    try {
        const occupancyData = await getOccupancyReport(); // Fetch occupancy report data from the database
        if (!occupancyData) {
            await sendWhatsAppTextMessage(phone, "No occupancy data available.");
            return;
        }

        let message = "📌 *Occupancy Report*\n\n";
        message += `🏨 Total Rooms: ${occupancyData.total_rooms}\n`;
        message += `✅ Occupied Rooms: ${occupancyData.occupied_rooms}\n`;
        message += `❌ Available Rooms: ${occupancyData.available_rooms}\n`;
        message += `📈 Occupancy Rate: ${occupancyData.occupancy_rate}%\n`;

        await sendWhatsAppTextMessage(phone, message);
    } catch (error) {
        console.error("Error sending occupancy report:", error);
        await sendWhatsAppTextMessage(phone, "Failed to retrieve occupancy report. Please try again later.");
    }
}

async function getOccupancyReport() {
    return new Promise((resolve, reject) => {
        db.get(
            `SELECT 
                COUNT(*) AS total_rooms,
                SUM(CASE WHEN availability > 0 THEN 1 ELSE 0 END) AS available_rooms,
                SUM(CASE WHEN availability = 0 THEN 1 ELSE 0 END) AS occupied_rooms,
                ROUND((SUM(CASE WHEN availability = 0 THEN 1 ELSE 0 END) * 100.0) / COUNT(*), 2) AS occupancy_rate
            FROM rooms`,
            (err, row) => {
                if (err) reject(err);
                resolve(row);
            }
        );
    });
}

async function sendFeedbackSummary(phone) {
    try {
        const feedbackData = await getFeedbackSummary(); // Fetch feedback summary from the database
        if (!feedbackData || feedbackData.length === 0) {
            await sendWhatsAppTextMessage(phone, "No recent feedback available.");
            return;
        }

        let message = "📌 *Recent Customer Feedback*\n\n";
        feedbackData.forEach((feedback, index) => {
            message += `📝 Feedback #${index + 1}\n`;
            message += `👤 Guest: ${feedback.guest_name}\n`;
            message += `⭐ Rating: ${feedback.rating}/5\n`;
            message += `💬 Comment: ${feedback.comment}\n`;
            message += `📆 Date: ${feedback.created_at}\n`;
            message += "-------------------\n";
        });

        await sendWhatsAppTextMessage(phone, message);
    } catch (error) {
        console.error("Error sending feedback summary:", error);
        await sendWhatsAppTextMessage(phone, "Failed to retrieve feedback. Please try again later.");
    }
}

async function getFeedbackSummary() {
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT u.name AS guest_name, f.rating, f.feedback AS comment, f.created_at
            FROM feedback f
            JOIN bookings b ON f.booking_id = b.id
            JOIN users u ON b.user_id = u.id
            ORDER BY f.created_at DESC
            LIMIT 5`, // Fetch the latest 5 feedback entries
            (err, rows) => {
                if (err) reject(err);
                resolve(rows);
            }
        );
    });
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
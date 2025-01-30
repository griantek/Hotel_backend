// Enhanced AdminBot Implementation
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
                (SELECT COUNT(*) FROM bookings WHERE verification_status = 'pending') as pending_verifications,
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

            case 'pending_verifications':
                await sendPendingVerifications(phone);
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

// Enhanced message sending functions
async function sendDashboardSummary(phone) {
    const summary = await getDashboardSummary();
    const message = 
        `📊 *Dashboard Summary*\n\n` +
        `Today's Check-ins: ${summary.today_checkins}\n` +
        `Today's Check-outs: ${summary.today_checkouts}\n` +
        `Pending Verifications: ${summary.pending_verifications}\n` +
        `Unpaid Bookings: ${summary.unpaid_bookings}\n` +
        `New Feedback: ${summary.new_feedback}\n` +
        `Today's Revenue: $${summary.today_revenue || 0}\n\n` +
        `For detailed reports, visit: ${process.env.ADMIN_DASHBOARD_URL}/dashboard`;

    await sendWhatsAppTextMessage(phone, message);
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
        `🏨 Room: ${action.room_number}\n` +
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
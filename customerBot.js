// Required dependencies
const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const schedule = require('node-schedule');
require('dotenv').config();
const app = express();
app.use(bodyParser.json());
const moment = require('moment');
const path = require('path');
const fs = require('fs').promises;

// Database connection
const db = new sqlite3.Database('hotel.db');

// WhatsApp API configuration
const WHATSAPP_API_URL = `${process.env.WHATSAPP_API_URL}`;
const WHATSAPP_ACCESS_TOKEN = `${process.env.WHATSAPP_ACCESS_TOKEN}`;

// Time format
function formatTimeTo12Hour(time) {
    const [hour, minute] = time.split(':');
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const formattedHour = hour % 12 || 12;
    return `${formattedHour}:${minute} ${ampm}`;
  }
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

// Add new helper functions for media messages
async function sendWhatsAppMedia(to, mediaType, url, caption) {
    try {
        const response = await axios.post(
            `${WHATSAPP_API_URL}`,
            {
                messaging_product: "whatsapp",
                recipient_type: "individual",
                to: to,
                type: mediaType,
                [mediaType]: {
                    link: url,
                    caption: caption || ""
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
        console.error('Error sending media:', error);
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
        console.log('Message sent successfully:', response.data);
        return response.data;
    } catch (error) {
        console.error('Error sending WhatsApp message:', error.response?.data || error.message);
        throw error;
    }
}

// Handle incoming messages
async function handleIncomingMessage(phone, message, name) {
    try {
        const user = await getUserByPhone(phone);
        const hasBookings = user ? await checkUserBookings(user.id) : false;
        userName = user?.name || name;

        // Add handling for text "services"
        if (message.type === 'text') {
            const text = message.text.body.toLowerCase();
            if (text === 'hi') {
                await sendInitialGreeting(phone, userName, hasBookings);
            } else if (text === 'services') {
                await sendServiceOptions(phone, user);
            }
        } else if (message.type === 'interactive') {
            // Log the interactive message structure for debugging
            console.log('Interactive message received:', JSON.stringify(message.interactive));
            
            if (!message.interactive) {
                throw new Error('Invalid interactive message format');
            }
            
            await handleButtonResponse(phone, userName, message.interactive, user);
        } else if (message.type === 'image') {
            try {
                const pendingVerification = await getActiveBooking(phone);
                
                if (!pendingVerification || 
                    pendingVerification.verification_status !== 'pending' || 
                    !pendingVerification.selected_id_type) {
                    await sendWhatsAppTextMessage(
                        phone,
                        "I received your image but I'm not expecting any images at the moment. If you're trying to verify your ID, please start the check-in process first."
                    );
                    return;
                }
            
                // Log the entire message object to see what we receive
                console.log('Received image message:', JSON.stringify(message, null, 2));
            
                // Get permanent media URL
                if (!message.image || !message.image.id) {
                    throw new Error('No image ID received');
                }
            
                const mediaUrl = await getMediaUrl(message.image.id);
                console.log('Retrieved media URL:', mediaUrl);
            
                if (!mediaUrl) {
                    throw new Error('Failed to get media URL');
                }
            
                await handleIdVerification(phone, { url: mediaUrl }, pendingVerification);
            } catch (error) {
                console.error('Error processing image:', error);
                await sendWhatsAppTextMessage(
                    phone,
                    "Sorry, there was an error processing your ID image. Please try again."
                );
            }
        }
    } catch (error) {
        console.error('Error handling message:', error);
        // Send fallback message to user
        await sendWhatsAppTextMessage(phone, 
            'Sorry, I encountered an error processing your request. Please try again or type "hi" to start over.'
        );
    }
}

// Send initial greeting with appropriate buttons
async function sendInitialGreeting(phone, name, hasBookings) {
    // First send welcome image
    await sendWhatsAppMedia(phone, "image", 
        `${process.env.HOTEL_WELCOME_IMAGE_URL}`, 
        `Welcome to ${process.env.HOTEL_NAME}`
    );
    const greeting = name ? `Hello ${name}!` : 'Hello!';
    const buttons = hasBookings ? [
        {
            "type": "reply",
            "reply": {
                "id": "view_bookings",
                "title": "View Your Bookings"
            }
        },
        {
            "type": "reply",
            "reply": {
                "id": "our_services",
                "title": "Our Services"
            }
        },
        {
            "type": "reply",
            "reply": {
                "id": "contact_us",
                "title": "Contact Us"
            }
        }
    ] : [
        {
            "type": "reply",
            "reply": {
                "id": "book_room",
                "title": "Book a Room"
            }
        },
        {
            "type": "reply",
            "reply": {
                "id": "our_services",
                "title": "Our Services"
            }
        },
        {
            "type": "reply",
            "reply": {
                "id": "contact_us",
                "title": "Contact Us"
            }
        }
    ];

    await sendWhatsAppMessage(phone, {
        interactive: {
            type: "button",
            body: {
                text: `${greeting} Welcome to ${process.env.HOTEL_NAME}. How can I assist you today?`
            },
            action: {
                buttons: buttons
            }
        }
    });
}

// Send list message for services
async function sendServicesList(phone) {
    try {
        await sendWhatsAppMessage(phone, {
            interactive: {
                type: "list",
                header: {
                    type: "text",
                    text: "Our Services"
                },
                body: {
                    text: "Explore our premium services and amenities"
                },
                footer: {
                    text: "Select a service to learn more"
                },
                action: {
                    button: "View Services",
                    sections: [
                        {
                            title: "Accommodation",
                            rows: [
                                {
                                    id: "rooms_gallery",
                                    title: "Room Types",
                                    description: "View our luxurious rooms"
                                },
                                {
                                    id: "check_availability",
                                    title: "Check Availability",
                                    description: "Check room availability & prices"
                                }
                            ]
                        },
                        {
                            title: "Amenities",
                            rows: [
                                {
                                    id: "dining",
                                    title: "Dining",
                                    description: "Restaurant & room service info"
                                },
                                {
                                    id: "spa",
                                    title: "Spa & Wellness",
                                    description: "Relaxation & fitness facilities"
                                }
                            ]
                        }
                    ]
                }
            }
        });
    } catch (error) {
        console.error('Error sending services list:', error);
        throw error;
    }
}
                        
// Handle button responses
async function handleButtonResponse(phone, name, interactive, user) {
    // Check for both button replies and list replies
    const buttonId = interactive.button_reply?.id || interactive.list_reply?.id;
    
    if (!buttonId) {
        console.error('No valid button or list ID found in response:', interactive);
        await sendWhatsAppTextMessage(phone, 'Sorry, there was an error processing your request. Please try again.');
        return;
    }

    // Add service request handling
    if (buttonId.startsWith('service_')) {
        const serviceId = buttonId.split('_')[1];
        await handleServiceRequest(phone, user, serviceId);
        return;
    }

    switch (buttonId) {
        case 'book_room':
            const hasBookings = user ? await checkUserBookings(user.id) : false;
    
            if (hasBookings) {
                await sendWhatsAppMessage(phone, {
                    interactive: {
                        type: "button",
                        body: {
                            text: "You have an existing booking. Would you like to modify your booking?"
                        },
                        action: {
                            buttons: [
                                {
                                    type: "reply",
                                    reply: {
                                        id: "modify_booking",
                                        title: "Modify Existing"
                                    }
                                }
                            ]
                        }
                    }
                });
            } else {
                const bookingLink = await generateBookingLink(phone, name);
                await sendWhatsAppTextMessage(
                    phone, 
                    `Click the link below to make your reservation. Our online booking system will guide you through the process: ${bookingLink}`
                );
                // Schedule follow-up if no booking is made
                scheduleBookingFollowUp(phone);
            }
            break;

        case 'view_bookings':
            const bookings = await getUserBookings(user.id);
            await sendBookingDetails(phone, name, bookings);
            break;

        case 'modify_booking':
            const booking = await getUserBookings(user.id);
            const modifyLink = await generateModifyLink(booking[0].id);
            await sendWhatsAppTextMessage(phone, `Click below to modify your booking. You'll be able to change dates, room type, or add services.: ${modifyLink}`);
            break;

        case 'cancel_booking':
            await sendCancellationConfirmation(phone);
            break;

        case 'confirm_cancel':
            await cancelBooking(user.id);
            await sendCancellationSuccess(phone);
            break;

        case 'contact_us':
            await sendContactInfo(phone);
            break;
        case 'location':
            await sendLocation(phone);
            break;

        case 'our_services':
            await sendServicesList(phone);
            break;

        case 'rooms_gallery':
            await sendRoomGallery(phone);
            break;

        case 'check_availability':
            await initiateAvailabilityCheck(phone);
            break;

        case 'dining':
            await sendDiningInfo(phone);
            break;

        case 'spa':
            await sendSpaInfo(phone);
            break;
            
        case 'services':
        case 'room_service':
            await sendServiceOptions(phone, user);
            break;

        case 'food_menu':
            await sendFoodMenu(phone);
            break;
            
        case 'housekeeping_menu':
            await sendHousekeepingMenu(phone);
            break;
            
        case 'amenities_menu':
            await sendAmenitiesMenu(phone);
            break;
            
        case 'maintenance_menu':
            await sendMaintenanceMenu(phone);
            break;

        case 'start_checkin':
            await sendIdTypeSelection(phone);
            break;

        case 'select_passport':
        case 'select_aadhar':
        case 'select_voter':
        case 'select_license':
            const idType = buttonId.replace('select_', '');
            await handleIdTypeSelection(phone, idType);
            break;

        case 'verify_correct':
            const verifiedBooking = await getActiveBooking(phone);
            if (verifiedBooking.paid_status !== 'paid') {
                await requestPayment(phone, verifiedBooking);
            } else {
                await completeCheckin(phone, verifiedBooking);
            }
            break;

        default:
            await sendWhatsAppTextMessage(phone, 'I apologize, but I didn\'t understand that. Please try again.');
            break;
    }
}

// Send location
async function sendLocation(phone) {
    try {
        const latitude = process.env.HOTEL_LATITUDE;
        const longitude = process.env.HOTEL_LONGITUDE;

        // Validate environment variables
        if (!latitude || !longitude) {
            throw new Error("Latitude or Longitude is not defined in environment variables.");
        }

        const response = await axios({
            method: "POST",
            url: `${WHATSAPP_API_URL}`,
            headers: {
                "Authorization": `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
                "Content-Type": "application/json",
            },
            data: {
                messaging_product: "whatsapp",
                to: phone,
                type: "location",
                location: {
                    latitude: latitude,
                    longitude: longitude,
                    name: `${process.env.HOTEL_NAME}`, 
                    address: `${process.env.HOTEL_ADDRESS}` 
                }
            }
        });
        return response.data;
    } catch (error) {
        console.error("Error sending location:", error.response?.data || error.message);
        throw new Error("Failed to send location");
    }
}

// Generate booking/modify links
async function generateBookingLink(phone, name) {
    try {
        // Call the generate-token endpoint
        const response = await axios.get(`${process.env.BACKEND_URL}/generate-token`, {
            params: {
                phone: phone,
                name: name
            }
        });

        // Extract the token from the response
        const token = response.data.token;
        return `${process.env.WEB_APP_URL}/booking?token=${token}`;
    } catch (error) {
        console.error('Error generating booking link:', error.response?.data || error.message);
        throw new Error('Failed to generate booking link');
    }
}

async function generateModifyLink(id) {
    try {
        // Call the generate-token endpoint
        const response = await axios.get(`${process.env.BACKEND_URL}/generate-token`, {
            params: {
                id: id
            }
        });
        // Extract the token from the response
        const token = response.data.token;
        return `${process.env.WEB_APP_URL}/modify?token=${token}`;
    } catch (error) {
        console.error('Error generating modify link:', error.response?.data || error.message);
        throw new Error('Failed to generate modify link');
    }
}

// Schedule reminders and follow-ups
function scheduleBookingFollowUp(phone) {
    // Schedule follow-up after 1 hour if no booking is made
    schedule.scheduleJob(new Date(Date.now() + 5 * 60 * 1000), async () => {
        const user = await getUserByPhone(phone);
        const hasBooked = user ? await checkUserBookings(user.id) : false;
        if (!hasBooked) {
            await sendFollowUpMessage(phone);
        }
    });
}



// Database helper functions
async function getUserByPhone(phone) {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM users WHERE phone = ?', [phone], (err, row) => {
            if (err) reject(err);
            resolve(row);
        });
    });
}

async function checkUserBookings(userId) {
    return new Promise((resolve, reject) => {
        db.get(
            'SELECT COUNT(*) as count FROM bookings WHERE user_id = ? AND status = "confirmed"',
            [userId],
            (err, row) => {
                if (err) reject(err);
                resolve(row.count > 0);
            }
        );
    });
}
async function getUserBookings(userId) {
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT * FROM bookings 
             WHERE user_id = ? AND status == 'confirmed' 
             ORDER BY check_in_date DESC`,
            [userId],
            (err, rows) => {
                if (err) reject(err);
                resolve(rows);
            }
        );
    });
}

async function cancelBooking(userId) {
    // Get the user's bookings
    const bookings = await getUserBookings(userId);

    if (!bookings || bookings.length === 0) {
        throw new Error('No active bookings found for the user.');
    }

    // Use the first booking's ID to call the DELETE API
    try {
        const bookingId = bookings[0].id; // Assuming `getUserBookings` returns a list of bookings
        const response = await axios.delete(`${process.env.BACKEND_URL}/api/bookings/${bookingId}`);
        return response.data; // Return API response
    } catch (error) {
        console.error('Error canceling booking via API:', error.message);
        throw error;
    }
}

// Message sending functions


async function sendBookingDetails(phone, name ,bookings) {
    if (!bookings.length) {
        await sendWhatsAppMessage(phone, {
            interactive: {
                type: "button",
                body: {
                    text: "You don't have any active bookings. Would you like to make a reservation?"
                },
                action: {
                    buttons: [{
                        type: "reply",
                        reply: {
                            id: "book_room",
                            title: "Book Now"
                        }
                    }]
                }
            }
        });
        return;
    }

    const bookingsList = bookings.map(booking => 
        `🔹 Booking ID: ${booking.id}\n` +
        `📅 Check-in: ${new Date(booking.check_in_date).toLocaleDateString()} at ${formatTimeTo12Hour(booking.check_in_time)}\n` +
        `📅 Check-out: ${new Date(booking.check_out_date).toLocaleDateString()} at ${formatTimeTo12Hour(booking.check_out_time)}\n` +
        `🏨 Room Type: ${booking.room_type}\n` +
        `👥 Guests: ${booking.guest_count}\n` + 
        `💵 Price: $${booking.total_price.toFixed(2)}\n`
    ).join('\n');

    await sendWhatsAppMessage(phone, {
        interactive: {
            type: "button",
            body: {
                text: `Hey ${name}, Here are your bookings:\n\n${bookingsList}`
            },
            action: {
                buttons: [
                    {
                        type: "reply",
                        reply: {
                            id: "modify_booking",
                            title: "Modify Booking"
                        }
                    },
                    {
                        type: "reply",
                        reply: {
                            id: "cancel_booking",
                            title: "Cancel Booking"
                        }
                    }
                ]
            }
        }
    });
}

async function sendCancellationConfirmation(phone) {
    await sendWhatsAppMessage(phone, {
        interactive: {
            type: "button",
            body: {
                text: "Are you sure you want to cancel your booking? This action cannot be undone."
            },
            action: {
                buttons: [
                    {
                        type: "reply",
                        reply: {
                            id: "confirm_cancel",
                            title: "Yes, Cancel"
                        }
                    },
                    {
                        type: "reply",
                        reply: {
                            id: "keep_booking",
                            title: "No, Keep Booking"
                        }
                    }
                ]
            }
        }
    });
}
async function sendCancellationSuccess(phone) {
    await sendWhatsAppMessage(phone, {
        interactive: {
            type: "button",
            body: {
                text: "Your booking has been successfully cancelled. Would you like to make a new reservation?"
            },
            action: {
                buttons: [{
                    type: "reply",
                    reply: {
                        id: "book_room",
                        title: "Book New Room"
                    }
                }]
            }
        }
    });
}
async function sendContactInfo(phone) {
    await sendWhatsAppMessage(phone, {
        interactive: {
            type: "button",
            body: {
                text: "You can reach us through:\n\n" +
                      `📞 Phone: ${process.env.HOTEL_PHONE}\n` +
                      `📧 Email: ${process.env.HOTEL_EMAIL}\n `+
                      `📍 Address: ${process.env.HOTEL_ADDRESS}\n\n` +
                      "Our front desk is available 24/7."
            },
            action: {
                buttons: [{
                    type: "reply",
                    reply: {
                        id: "location",
                        title: "View Location"
                    }
                }]
            }
        }
    });
}
async function sendFollowUpMessage(phone) {
    await sendWhatsAppMessage(phone, {
        interactive: {
            type: "button",
            body: {
                text: "We noticed you haven't completed your booking. Do you need any assistance or have questions about our rooms?"
            },
            action: {
                buttons: [
                    {
                        type: "reply",
                        reply: {
                            id: "book_room",
                            title: "Continue Booking"
                        }
                    },
                    {
                        type: "reply",
                        reply: {
                            id: "contact_us",
                            title: "Need Help"
                        }
                    }
                ]
            }
        }
    });
}

// Add after existing helper functions
async function sendRoomGallery(phone) {
    try {
        const BASE_URL = process.env.BASE_URL ; // Default base URL
        
        // Send welcome message
        await sendWhatsAppTextMessage(phone, "Here are our luxurious room types:");
        
        // Get room types from database
        const rooms = await new Promise((resolve, reject) => {
            db.all(
                'SELECT r.*, GROUP_CONCAT(rp.photo_url) as photos FROM rooms r LEFT JOIN room_photos rp ON r.id = rp.room_id GROUP BY r.id', 
                [], 
                (err, rows) => {
                    if (err) reject(err);
                    resolve(rows);
                }
            );
        });

        // Send each room type with photos
        for (const room of rooms) {
            let photos = room.photos ? room.photos.split(',') : [];
            
            // Convert relative paths to public URLs
            photos = photos.map(photo => `${BASE_URL}${photo}`);

            if (photos.length > 0) {
                await sendWhatsAppMedia(phone, "image", photos[0], 
                    `*${room.type}*\nPrice: $${room.price}/night\nTotal rooms: ${room.availability}`
                );
            }
        }

        // Send booking prompt
        await sendWhatsAppMessage(phone, {
            interactive: {
                type: "button",
                body: {
                    text: "Would you like to book a room or check availability?"
                },
                action: {
                    buttons: [
                        {
                            type: "reply",
                            reply: {
                                id: "book_room",
                                title: "Book Now"
                            }
                        },
                        {
                            type: "reply",
                            reply: {
                                id: "check_availability",
                                title: "Check Availability"
                            }
                        }
                    ]
                }
            }
        });
    } catch (error) {
        console.error('Error sending room gallery:', error);
        throw error;
    }
}

async function sendDiningInfo(phone) {
    // First send restaurant image
    await sendWhatsAppMedia(phone, "image", 
        `${process.env.HOTEL_RESTAURANT_IMAGE}`,
        "Our Fine Dining Restaurant"
    );

    // Send dining info message
    await sendWhatsAppTextMessage(phone, 
        "*🍽️ Dining Services*\n\n" +
        "�restaurants Restaurant Hours:\n" +
        "Breakfast: 6:30 AM - 10:30 AM\n" +
        "Lunch: 12:00 PM - 3:00 PM\n" +
        "Dinner: 6:30 PM - 11:00 PM\n\n" +
        "🛎️ Room Service Available 24/7\n\n" +
        "For reservations or special dietary requirements, please contact us."
    );
}

async function sendSpaInfo(phone) {
    // Send spa image
    await sendWhatsAppMedia(phone, "image", 
        `${process.env.HOTEL_SPA_IMAGE}`,
        "Rejuvenate at Our Spa"
    );

    // Send spa services info
    await sendWhatsAppTextMessage(phone,
        "*✨ Spa & Wellness*\n\n" +
        "🧖‍♀️ Services:\n" +
        "- Therapeutic Massages\n" +
        "- Facial Treatments\n" +
        "- Body Wraps\n" +
        "- Aromatherapy\n\n" +
        "⏰ Hours: 9:00 AM - 9:00 PM\n\n" +
        "For appointments, please contact our spa reception."
    );
}

async function initiateAvailabilityCheck(phone) {
    try {
        const today = moment().format("YYYY-MM-DD"); // Get the current date

        // Get the current availability by considering existing bookings
        const rooms = await new Promise((resolve, reject) => {
            db.all(
                `SELECT r.type, r.availability, r.price, 
                        IFNULL(
                            (SELECT COUNT(*) FROM bookings b 
                             WHERE b.room_type = r.type 
                             AND b.status = 'confirmed' 
                             AND b.check_in_date <= ? 
                             AND b.check_out_date > ?), 
                            0
                        ) as booked_rooms
                 FROM rooms r`,
                [today, today],
                (err, rows) => {
                    if (err) reject(err);
                    resolve(rows);
                }
            );
        });

        // Format the availability message
        const availabilityText = rooms.map(room => {
            const remainingRooms = Math.max(room.availability - room.booked_rooms, 0);
            return `*${room.type}*\nAvailable: ${remainingRooms} rooms\nPrice: $${room.price}/night\n`;
        }).join("\n");

        // Send availability details
        await sendWhatsAppMessage(phone, {
            interactive: {
                type: "button",
                body: {
                    text: `📅 *Current Availability (${today})*:\n\n${availabilityText}\nWould you like to make a booking?`
                },
                action: {
                    buttons: [{
                        type: "reply",
                        reply: {
                            id: "book_room",
                            title: "Book Now"
                        }
                    }]
                }
            }
        });
    } catch (error) {
        console.error("Error checking availability:", error);
        throw error;
    }
}

async function sendServiceOptions(phone, user) {
    try {
        // First verify if user is checked in
        const activeBooking = await getActiveCheckedInBooking(user.id);
        if (!activeBooking) {
            await sendWhatsAppTextMessage(phone,
                "Sorry, hotel services are only available for checked-in guests. Please contact the front desk for assistance."
            );
            return;
        }

        // First send main categories
        await sendWhatsAppMessage(phone, {
            interactive: {
                type: "list",
                header: {
                    type: "text",
                    text: "Hotel Services"
                },
                body: {
                    text: "Please select a service category:"
                },
                footer: {
                    text: "Available 24/7"
                },
                action: {
                    button: "View Categories",
                    sections: [
                        {
                            title: "Available Services",
                            rows: [
                                {
                                    id: "food_menu",
                                    title: "Food & Beverages",
                                    description: "Room service, dining options"
                                },
                                {
                                    id: "housekeeping_menu",
                                    title: "Housekeeping",
                                    description: "Room cleaning, laundry, etc"
                                },
                                {
                                    id: "amenities_menu",
                                    title: "Room Amenities",
                                    description: "Extra items and supplies"
                                },
                                {
                                    id: "maintenance_menu",
                                    title: "Maintenance",
                                    description: "Technical support and fixes"
                                }
                            ]
                        }
                    ]
                }
            }
        });

    } catch (error) {
        console.error('Error sending service options:', error);
        await sendWhatsAppTextMessage(phone, 
            'Sorry, there was an error retrieving our services. Please try again or contact the front desk for assistance.'
        );
    }
}

// Add this helper function to check if user is checked in
async function getActiveCheckedInBooking(userId) {
    return new Promise((resolve, reject) => {
        db.get(
            `SELECT * FROM bookings 
             WHERE user_id = ? 
             AND status = 'confirmed' 
             AND checkin_status = 'checked_in'
             AND check_in_date <= date('now')
             AND check_out_date >= date('now')`,
            [userId],
            (err, booking) => {
                if (err) reject(err);
                resolve(booking);
            }
        );
    });
}

async function sendFoodMenu(phone) {
    try {
        const foodServices = await getServicesByCategory('Food');
        await sendWhatsAppMessage(phone, {
            interactive: {
                type: "list",
                header: {
                    type: "text",
                    text: "Food & Beverages"
                },
                body: {
                    text: "Select an item to order:"
                },
                action: {
                    button: "View Menu",
                    sections: [{
                        title: "Available Items",
                        rows: foodServices.map(service => ({
                            id: `service_${service.id}`,
                            title: service.name,
                            description: service.description + (service.price ? ` - $${service.price}` : '')
                        }))
                    }]
                }
            }
        });
    } catch (error) {
        console.error('Error sending food menu:', error);
        throw error;
    }
}

async function sendHousekeepingMenu(phone) {
    try {
        const housekeepingServices = await getServicesByCategory('Housekeeping');
        await sendWhatsAppMessage(phone, {
            interactive: {
                type: "list",
                header: {
                    type: "text",
                    text: "Housekeeping Services"
                },
                body: {
                    text: "Select a service to request:"
                },
                action: {
                    button: "View Services",
                    sections: [{
                        title: "Available Services",
                        rows: housekeepingServices.map(service => ({
                            id: `service_${service.id}`,
                            title: service.name,
                            description: service.description + (service.price ? ` - $${service.price}` : '')
                        }))
                    }]
                }
            }
        });
    } catch (error) {
        console.error('Error sending housekeeping menu:', error);
        throw error;
    }
}

async function sendAmenitiesMenu(phone) {
    try {
        const amenityServices = await getServicesByCategory('Amenities');
        await sendWhatsAppMessage(phone, {
            interactive: {
                type: "list",
                header: {
                    type: "text",
                    text: "Room Amenities"
                },
                body: {
                    text: "Select an amenity to request:"
                },
                action: {
                    button: "View Amenities",
                    sections: [{
                        title: "Available Items",
                        rows: amenityServices.map(service => ({
                            id: `service_${service.id}`,
                            title: service.name,
                            description: service.description + (service.price ? ` - $${service.price}` : '')
                        }))
                    }]
                }
            }
        });
    } catch (error) {
        console.error('Error sending amenities menu:', error);
        throw error;
    }
}

async function sendMaintenanceMenu(phone) {
    try {
        const maintenanceServices = await getServicesByCategory('Maintenance');
        await sendWhatsAppMessage(phone, {
            interactive: {
                type: "list",
                header: {
                    type: "text",
                    text: "Maintenance"
                },
                body: {
                    text: "What issue would you like to report?"
                },
                action: {
                    button: "View List",
                    sections: [{
                        rows: maintenanceServices.map(service => ({
                            id: `service_${service.id}`,
                            title: service.name
                        }))
                    }]
                }
            }
        });
    } catch (error) {
        console.error('Error sending maintenance menu:', error);
        await sendWhatsAppTextMessage(phone, 
            "Sorry, I couldn't display the maintenance menu. Please contact the front desk for assistance."
        );
    }
}

// Add this helper function to get services by category
async function getServicesByCategory(category) {
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT id, name, description, price 
             FROM hotel_services 
             WHERE category = ? AND availability = 1 
             ORDER BY name`,
            [category],
            (err, rows) => {
                if (err) reject(err);
                resolve(rows);
            }
        );
    });
}

// Add this helper function to get service details
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

// Update handleServiceRequest function to be simpler
async function handleServiceRequest(phone, user, serviceId) {
    try {
        const booking = await getActiveCheckedInBooking(user.id);
        const service = await getServiceById(serviceId);
        
        if (!service) {
            await sendWhatsAppTextMessage(phone, "Service not found. Please try again.");
            return;
        }

        // Send immediate confirmation to user
        const message = getServiceConfirmationMessage(service.category, service.name);
        await sendWhatsAppTextMessage(phone, message);

    } catch (error) {
        console.error('Error handling service request:', error);
        await sendWhatsAppTextMessage(phone, 
            'Sorry, there was an error processing your request. Please try again or contact the front desk.'
        );
    }
}

// Add new helper function for service confirmation messages
function getServiceConfirmationMessage(category, serviceName) {
    const messages = {
        'Food': `✅ Thank you for your order of ${serviceName}. Our kitchen staff will prepare and deliver your meal shortly.`,
        'Housekeeping': `✅ Your request for ${serviceName} has been received. Our housekeeping staff will attend to your room shortly.`,
        'Amenities': `✅ Your request for ${serviceName} has been received. Our staff will deliver it to your room shortly.`,
        'Maintenance': `✅ Your ${serviceName} request has been logged. Our maintenance team will assist you shortly.`
    };
    return messages[category] || `✅ Your request for ${serviceName} has been received. Our staff will assist you shortly.`;
}

// Add to database schema
db.run(`CREATE TABLE IF NOT EXISTS service_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id INTEGER NOT NULL,
    service_id INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    FOREIGN KEY (booking_id) REFERENCES bookings (id),
    FOREIGN KEY (service_id) REFERENCES hotel_services (id)
)`);

// Add new helper function to get meal times
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

// Update sendCheckinWelcomeMessage function
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

        await sendWhatsAppTextMessage(phone, welcomeMessage);
        
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
                await sendWhatsAppTextMessage(phone, activeService.message_template);
                await recordReminderSent(booking.id, activeService.id);
            }
        }
    } catch (error) {
        console.error('Error scheduling immediate service reminder:', error);
    }
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

// Add scheduled task to send service reminders
schedule.scheduleJob('* * * * *', async function() {
    const currentTime = moment().format('HH:mm:00');
    
    try {
        // Get active service for current time
        const activeService = await new Promise((resolve, reject) => {
            db.get(
                `SELECT * FROM service_schedules 
                 WHERE time(start_time) = time(?)
                 AND active = 1`,
                [currentTime],
                (err, row) => {
                    if (err) reject(err);
                    resolve(row);
                }
            );
        });

        if (activeService) {
            // Get all checked-in guests
            const activeBookings = await new Promise((resolve, reject) => {
                db.all(
                    `SELECT b.id, b.room_number, u.phone 
                     FROM bookings b
                     JOIN users u ON b.user_id = u.id
                     WHERE b.checkin_status = 'checked_in'
                     AND b.status = 'confirmed'`,
                    [],
                    (err, rows) => {
                        if (err) reject(err);
                        resolve(rows);
                    }
                );
            });

            // Send reminders to each guest
            for (const booking of activeBookings) {
                const reminderSent = await checkReminderSent(booking.id, activeService.id);
                if (!reminderSent) {
                    await sendWhatsAppTextMessage(booking.phone, activeService.message_template);
                    await recordReminderSent(booking.id, activeService.id);
                }
            }
        }
    } catch (error) {
        console.error('Error in service reminder scheduler:', error);
    }
});

// Add after message handling
async function getActiveBooking(phone) {
    return new Promise((resolve, reject) => {
        db.get(
            `SELECT b.* FROM bookings b
             JOIN users u ON b.user_id = u.id
             WHERE u.phone = ? AND b.status = 'confirmed' AND b.checkin_status = 'pending'`,
            [phone],
            (err, row) => {
                if (err) reject(err);
                resolve(row);
            }
        );
    });
}

const { verifyID } = require('./handlers/idVerification');

// Update the handleIdVerification function
async function handleIdVerification(phone, image, booking) {
    try {
        // Verify ID
        const imagePath = image.url;
        
        // Check if file exists and wait for it to be accessible
        try {
            await fs.access(imagePath);
            console.log('File exists and is accessible:', imagePath);
        } catch (error) {
            console.error('File access error:', error);
            throw new Error('Image file is not accessible');
        }

        const verificationResult = await verifyID(
            imagePath, 
            booking.selected_id_type, 
            booking.id,
            db
        );

        // Rest of the verification handling...
        await sendWhatsAppMessage(phone, {
            interactive: {
                type: "button",
                body: {
                    text: `ID Verification Results:\n\n` +
                          `Name: ${verificationResult.name}\n` +
                          `ID Number: ${verificationResult.idNumber}\n` +
                          (verificationResult.dob ? `DOB: ${verificationResult.dob}\n\n` : '\n') +
                          `Is this information correct?`
                },
                action: {
                    buttons: [
                        {
                            type: "reply",
                            reply: {
                                id: "verify_correct",
                                title: "Yes, Correct"
                            }
                        },
                        {
                            type: "reply",
                            reply: {
                                id: "verify_incorrect",
                                title: "No, Incorrect"
                            }
                        }
                    ]
                }
            }
        });
    } catch (error) {
        console.error('Error handling ID verification:', error);
        await sendWhatsAppTextMessage(phone, 
            'Sorry, there was an error verifying your ID. Please try again or contact our support.'
        );

        // Clean up the file in case of error
        try {
            if (image.url) {
                await fs.unlink(image.url);
            }
        } catch (unlinkError) {
            console.error('Error deleting file:', unlinkError);
        }
    }
}

// Update getMediaUrl function
async function getMediaUrl(mediaId) {
    let tempFilePath = null;
    try {
        console.log('Getting media URL for ID:', mediaId);
        
        // Create uploads directory if it doesn't exist
        const uploadDir = path.join(__dirname, 'uploads', 'temp');
        await fs.mkdir(uploadDir, { recursive: true });
        console.log('Upload directory created/verified:', uploadDir);

        // Get media URL
        const mediaInfoResponse = await axios.get(
            `https://graph.facebook.com/v17.0/${mediaId}`,
            {
                headers: {
                    'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`
                }
            }
        );
        
        console.log('Media info response:', mediaInfoResponse.data);
        
        if (!mediaInfoResponse.data?.url) {
            throw new Error('No media URL found in response');
        }

        // Download media file
        const mediaResponse = await axios.get(mediaInfoResponse.data.url, {
            headers: {
                'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`
            },
            responseType: 'arraybuffer',
            timeout: 5000
        });

        // Generate unique filename
        const timestamp = Date.now();
        const randomString = Math.random().toString(36).substring(7);
        tempFilePath = path.join(uploadDir, `${timestamp}-${randomString}.jpg`);
        
        // Save file
        await fs.writeFile(tempFilePath, mediaResponse.data);
        console.log('Media file saved to:', tempFilePath);

        // Add a 5-second delay after saving
        await new Promise(resolve => setTimeout(resolve, 5000));
        console.log('Waited 5 seconds after saving file');

        // Verify file exists and is readable
        await fs.access(tempFilePath, fs.constants.R_OK);
        console.log('File verified as readable:', tempFilePath);

        return tempFilePath;

    } catch (error) {
        console.error('Error getting media URL:', error);
        // Clean up file if there was an error
        if (tempFilePath) {
            try {
                await fs.unlink(tempFilePath);
            } catch (unlinkError) {
                console.error('Error deleting temporary file:', unlinkError);
            }
        }
        return null;
    }
}

async function sendIdTypeSelection(phone) {
    await sendWhatsAppMessage(phone, {
        interactive: {
            type: "list",
            header: {
                type: "text",
                text: "ID Verification"
            },
            body: {
                text: "Please select the type of ID you'll be using:"
            },
            action: {
                button: "Select ID Type",
                sections: [{
                    title: "Available ID Types",
                    rows: [
                        {
                            id: "select_passport",
                            title: "🛂 Passport"
                        },
                        {
                            id: "select_aadhar",
                            title: "🆔 Aadhaar Card"
                        },
                        {
                            id: "select_voter",
                            title: "🗳️ Voter ID"
                        },
                        {
                            id: "select_license",
                            title: "🚗 Driving License"
                        }
                    ]
                }]
            }
        }
    });
}

async function handleIdTypeSelection(phone, idType) {
    try {
        const booking = await getActiveBooking(phone);
        if (!booking) {
            await sendWhatsAppTextMessage(phone, "No active booking found.");
            return;
        }

        await db.run(
            'UPDATE bookings SET selected_id_type = ?, verification_status = ? WHERE id = ?',
            [idType, 'pending', booking.id]
        );

        await sendWhatsAppTextMessage(
            phone,
            `Please upload a clear photo of your ${idType}.\n\n` +
            "Ensure that:\n" +
            "✅ All text is clearly visible\n" +
            "✅ The entire ID is in frame\n" +
            "✅ There's good lighting\n" +
            "✅ No glare or reflections\n\n" +
            "⚠️ This request will expire in 5 minutes for security purposes."
        );

        // Set timeout to clear verification status if not completed
        setTimeout(async () => {
            try {
                const currentBooking = await getActiveBooking(phone);
                if (currentBooking?.verification_status === 'pending') {
                    await db.run(
                        'UPDATE bookings SET selected_id_type = NULL, verification_status = "expired" WHERE id = ?',
                        [booking.id]
                    );
                    await sendWhatsAppTextMessage(
                        phone,
                        "ID verification request has expired. Please select ID type again to restart the process."
                    );
                }
            } catch (error) {
                console.error('Error in timeout handler:', error);
            }
        }, 5 * 60 * 1000); // 5 minutes timeout
    } catch (error) {
        console.error('Error handling ID type selection:', error);
        await sendWhatsAppTextMessage(
            phone,
            "Sorry, there was an error processing your ID type selection. Please try again."
        );
    }
}

async function requestPayment(phone, booking) {
    // Implement payment request logic here
    await sendWhatsAppTextMessage(phone, "Please proceed with the payment to complete your check-in.");
}

async function completeCheckin(phone, booking) {
    // Implement check-in completion logic here
    await sendWhatsAppTextMessage(phone, "Check-in completed successfully. Enjoy your stay!");
}

// Add this new helper function to get permanent media URL
async function getMediaUrl(mediaId) {
    let tempFilePath = null;
    try {
        console.log('Getting media URL for ID:', mediaId);
        
        // Create uploads directory if it doesn't exist
        const uploadDir = path.join(__dirname, 'uploads', 'temp');
        await fs.mkdir(uploadDir, { recursive: true });
        console.log('Upload directory created/verified:', uploadDir);

        // Get media URL
        const mediaInfoResponse = await axios.get(
            `https://graph.facebook.com/v17.0/${mediaId}`,
            {
                headers: {
                    'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`
                }
            }
        );
        
        console.log('Media info response:', mediaInfoResponse.data);
        
        if (!mediaInfoResponse.data?.url) {
            throw new Error('No media URL found in response');
        }

        // Download media file
        const mediaResponse = await axios.get(mediaInfoResponse.data.url, {
            headers: {
                'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`
            },
            responseType: 'arraybuffer',
            timeout: 5000
        });

        // Generate unique filename
        const timestamp = Date.now();
        const randomString = Math.random().toString(36).substring(7);
        tempFilePath = path.join(uploadDir, `${timestamp}-${randomString}.jpg`);
        
        // Save file
        await fs.writeFile(tempFilePath, mediaResponse.data);
        console.log('Media file saved to:', tempFilePath);

        // Add a 5-second delay after saving
        await new Promise(resolve => setTimeout(resolve, 5000));
        console.log('Waited 5 seconds after saving file');

        // Verify file exists and is readable
        await fs.access(tempFilePath, fs.constants.R_OK);
        console.log('File verified as readable:', tempFilePath);

        return tempFilePath;

    } catch (error) {
        console.error('Error getting media URL:', error);
        // Clean up file if there was an error
        if (tempFilePath) {
            try {
                await fs.unlink(tempFilePath);
            } catch (unlinkError) {
                console.error('Error deleting temporary file:', unlinkError);
            }
        }
        return null;
    }
}

// Start server
module.exports = {
    handleMessage: async (body) => {
        const message = body.entry[0].changes[0].value.messages[0];
        const senderId = message.from;
        const phone = senderId.replace('whatsapp:', '');
        const name = body.entry[0].changes[0].value.contacts?.[0]?.profile?.name || "Dear";
        
        await handleIncomingMessage(phone, message, name);
    }
};
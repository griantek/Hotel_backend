// Required dependencies
const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const schedule = require('node-schedule');
require('dotenv').config();
const app = express();
app.use(bodyParser.json());

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

// Webhook verification endpoint
app.get('/spa', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === 'eeee') {
            console.log('Webhook verified');
            res.status(200).send(challenge);
        } else {
            res.sendStatus(403);
        }
    }
});

// Webhook for incoming messages
app.post('/spa', async (req, res) => {
    const { body } = req;
    // Extract the phone_number_id from the payload
    const phoneNumberId = req.body.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;

    // Check if the phone_number_id matches the chatbot's ID
    if (phoneNumberId !== `${process.env.ID}`) {
        console.log(`Ignoring message sent to phone_number_id: ${phoneNumberId}`);
        return res.sendStatus(200); // Ignore the request
    }
    
    if (body.object) {
        if (body.entry && 
            body.entry[0].changes && 
            body.entry[0].changes[0].value.messages && 
            body.entry[0].changes[0].value.messages[0]) {

            const incomingMessage = req.body.entry[0].changes[0].value.messages[0];
            const senderId = incomingMessage.from; // WhatsApp ID (includes phone number)
            const phone = senderId.replace('whatsapp:', ''); // Extract phone number
            const name = req.body.entry[0].changes[0].value.contacts?.[0]?.profile?.name || "Dear"; // Fetch user name
            const message = body.entry[0].changes[0].value.messages[0];
            
            await handleIncomingMessage(phone, message, name);
        }
        res.status(200).send('EVENT_RECEIVED');
    } else {
        res.sendStatus(404);
    }
});

// Handle incoming messages
async function handleIncomingMessage(phone, message, name) {
    try {
        // Check if user exists and has bookings
        const user = await getUserByPhone(phone);
        const hasBookings = user ? await checkUserBookings(user.id) : false;
        userName = user?.name || name;

        if (message.type === 'text' && message.text.body.toLowerCase() === 'hi') {
            // Initial greeting with buttons
            await sendInitialGreeting(phone, userName , hasBookings);
        } else if (message.type === 'interactive') {
            await handleButtonResponse(phone, userName, message.interactive, user);
        }
    } catch (error) {
        console.error('Error handling message:', error);
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
    const buttonId = interactive.button_reply.id || interactive.list_reply?.id;

    switch (buttonId) {
        case 'book_room':
            const bookingLink = await generateBookingLink(phone, name);
            await sendWhatsAppTextMessage(phone, `Click the link below to make your reservation. Our online booking system will guide you through the process: ${bookingLink}`);
            // Schedule follow-up if no booking is made
            scheduleBookingFollowUp(phone);
            break;

        case 'view_bookings':
            const bookings = await getUserBookings(user.id);
            await sendBookingDetails(phone, bookings);
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


async function sendBookingDetails(phone, bookings) {
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
        `💵 Price: $${booking.total_price.toFixed(2)}\n`
    ).join('\n');

    await sendWhatsAppMessage(phone, {
        interactive: {
            type: "button",
            body: {
                text: `Here are your bookings:\n\n${bookingsList}`
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
        // Send welcome message
        await sendWhatsAppTextMessage(phone, "Here are our luxurious room types:");
        
        // Get room types from database
        const rooms = await new Promise((resolve, reject) => {
            db.all('SELECT r.*, GROUP_CONCAT(rp.photo_url) as photos FROM rooms r LEFT JOIN room_photos rp ON r.id = rp.room_id GROUP BY r.id', [], (err, rows) => {
                if (err) reject(err);
                resolve(rows);
            });
        });

        // Send each room type with photos
        for (const room of rooms) {
            const photos = room.photos ? room.photos.split(',') : [];
            if (photos.length > 0) {
                await sendWhatsAppMedia(phone, "image", photos[0], 
                    `*${room.type}*\nPrice: $${room.price}/night\nAvailable rooms: ${room.availability}`
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
        // Get room types and availability
        const rooms = await new Promise((resolve, reject) => {
            db.all('SELECT type, availability, price FROM rooms WHERE availability > 0', [], (err, rows) => {
                if (err) reject(err);
                resolve(rows);
            });
        });

        const availabilityText = rooms.map(room => 
            `*${room.type}*\n` +
            `Available: ${room.availability} rooms\n` +
            `Price: $${room.price}/night\n`
        ).join('\n');

        await sendWhatsAppMessage(phone, {
            interactive: {
                type: "button",
                body: {
                    text: `Current Availability:\n\n${availabilityText}\n\nWould you like to make a booking?`
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
        console.error('Error checking availability:', error);
        throw error;
    }
}
// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
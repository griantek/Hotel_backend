// Required dependencies
const express = require('express');
const bodyParser = require('body-parser');
require('dotenv').config();
const app = express();
app.use(bodyParser.json());

// Import bot handlers
const adminBot = require('./adminBot');
const customerBot = require('./customerBot');

app.get('/', (req, res) => {
    res.send('Hello World');
    console.log('Hello World');
});

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
    if (phoneNumberId !== process.env.ID) {
        console.log(`Ignoring message sent to phone_number_id: ${phoneNumberId}`);
        return res.sendStatus(200);
    }
    
    if (body.object) {
        if (body.entry && 
            body.entry[0].changes && 
            body.entry[0].changes[0].value.messages && 
            body.entry[0].changes[0].value.messages[0]) {

            const incomingMessage = req.body.entry[0].changes[0].value.messages[0];
            const senderId = incomingMessage.from;
            
            try {
                // Route to appropriate bot based on sender
                if (senderId === process.env.ADMIN) {
                    await adminBot.handleMessage(req.body);
                } else {
                    await customerBot.handleMessage(req.body);
                }
                
                res.status(200).send('EVENT_RECEIVED');
            } catch (error) {
                console.error('Error handling message:', error);
                res.status(500).send('Error processing message');
            }
        }
    } else {
        res.sendStatus(404);
    }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
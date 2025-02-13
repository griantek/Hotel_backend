const tesseract = require('tesseract.js');
const path = require('path');
const fs = require('fs');
const moment = require('moment');
const axios = require('axios');

class CheckinHandler {
    constructor(db, whatsappSender) {
        this.db = db;
        this.whatsapp = whatsappSender;
        this.uploadDir = path.join(__dirname, '../uploads/ids');
        
        if (!fs.existsSync(this.uploadDir)) {
            fs.mkdirSync(this.uploadDir, { recursive: true });
        }
    }

    async downloadImage(url) {
        const imagePath = path.join(this.uploadDir, `${Date.now()}.jpg`);
        const response = await axios({
            url,
            responseType: 'stream'
        });

        const writer = fs.createWriteStream(imagePath);
        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => resolve(imagePath));
            writer.on('error', reject);
        });
    }

    async processIdImage(imageUrl, idType, bookingId) {
        try {
            // Download image
            const imagePath = await this.downloadImage(imageUrl);
            
            // Perform OCR
            const result = await tesseract.recognize(imagePath);
            
            // Extract information based on ID type
            const extracted = this.extractIdInfo(result.data.text, idType);
            
            if (!extracted.name || !extracted.idNumber) {
                throw new Error('Could not extract required information from ID');
            }

            // Save verification details
            await this.saveVerificationDetails(bookingId, {
                ...extracted,
                idType,
                imagePath
            });

            return extracted;
        } catch (error) {
            console.error('Error processing ID:', error);
            throw error;
        }
    }

    extractIdInfo(text, idType) {
        const info = {
            name: null,
            idNumber: null,
            dob: null
        };

        const lines = text.split('\n').map(line => line.trim());
        
        for (const line of lines) {
            // Extract name (look for consecutive words with capital letters)
            if (!info.name && /^[A-Z][a-z]+ ([A-Z][a-z]+ )?[A-Z][a-z]+$/.test(line)) {
                info.name = line;
            }

            // Extract ID number based on type
            if (!info.idNumber) {
                switch (idType) {
                    case 'passport':
                        if (/^[A-Z][0-9]{7}$/.test(line)) {
                            info.idNumber = line;
                        }
                        break;
                    case 'aadhar':
                        const aadhar = line.replace(/\D/g, '');
                        if (aadhar.length === 12) {
                            info.idNumber = aadhar;
                        }
                        break;
                    case 'voter':
                        if (/^[A-Z]{3}[0-9]{7}$/.test(line)) {
                            info.idNumber = line;
                        }
                        break;
                    case 'license':
                        if (/^[A-Z]{2}[0-9]{13}$/.test(line)) {
                            info.idNumber = line;
                        }
                        break;
                }
            }

            // Extract DOB (common format dd/mm/yyyy or dd-mm-yyyy)
            if (!info.dob && /\d{2}[/-]\d{2}[/-]\d{4}/.test(line)) {
                info.dob = line.match(/\d{2}[/-]\d{2}[/-]\d{4}/)[0];
            }
        }

        return info;
    }

    async saveVerificationDetails(bookingId, details) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO verified_ids (
                    booking_id, id_type, id_number, name, dob, 
                    verification_status, id_image_path
                ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    bookingId,
                    details.idType,
                    details.idNumber,
                    details.name,
                    details.dob,
                    'Pending',
                    details.imagePath
                ],
                err => {
                    if (err) reject(err);
                    resolve();
                }
            );
        });
    }

    async updateBookingStatus(bookingId, updates) {
        const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
        const values = [...Object.values(updates), bookingId];

        return new Promise((resolve, reject) => {
            this.db.run(
                `UPDATE bookings SET ${fields} WHERE id = ?`,
                values,
                err => {
                    if (err) reject(err);
                    resolve();
                }
            );
        });
    }
}

module.exports = CheckinHandler;

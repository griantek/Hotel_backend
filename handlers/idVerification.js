const tesseract = require('tesseract.js');
const path = require('path');
const axios = require('axios');
const fs = require('fs');

class AadhaarVerifier {
  static async extractInfo(ocrText) {
    console.log('Extracted OCR Text:', ocrText);

    const lines = ocrText.split('\n');
    const info = {
      idNumber: null,
      name: null,
      dob: null
    };

    // Aadhaar number pattern: XXXX XXXX XXXX
    const aadhaarPattern = /[2-9]{1}[0-9]{3}\s[0-9]{4}\s[0-9]{4}/;
    
    // Name pattern: typically in all caps after "To" or starts with "श्री"/"श्रीमती" for Hindi
    const namePattern = /(?:To[\s:]+([A-Z\s]+))|(?:श्री(?:मती)?\s+([A-Z\s]+))/;
    
    // DOB pattern: DD/MM/YYYY or YYYY
    const dobPattern = /(?:DOB|Year of Birth|जन्म)[\s:]+([0-9]{2}\/[0-9]{2}\/[0-9]{4}|[0-9]{4})/i;

    for (const line of lines) {
      // Extract Aadhaar number
      if (!info.idNumber) {
        const aadhaarMatch = line.match(aadhaarPattern);
        if (aadhaarMatch) {
          info.idNumber = aadhaarMatch[0].replace(/\s/g, '');
        }
      }

      // Extract name
      if (!info.name) {
        const nameMatch = line.match(namePattern);
        if (nameMatch) {
          info.name = (nameMatch[1] || nameMatch[2]).trim();
        }
      }

      // Extract DOB
      if (!info.dob) {
        const dobMatch = line.match(dobPattern);
        if (dobMatch) {
          info.dob = dobMatch[1];
        }
      }
    }

    return info;
  }
}

async function verifyID(imageUrl, idType, bookingId, db) {
  try {
    // Download image
    const response = await axios({
      url: imageUrl,
      responseType: 'arraybuffer'
    });

    // Convert to Buffer
    const buffer = Buffer.from(response.data, 'binary');

    // Perform OCR
    const result = await tesseract.recognize(buffer, {
      lang: idType === 'aadhar' ? 'eng+hin' : 'eng'
    });

    console.log('OCR Result:', result.data.text);

    // Extract information based on ID type
    let extractedInfo;
    switch (idType) {
      case 'aadhar':
        extractedInfo = await AadhaarVerifier.extractInfo(result.data.text);
        break;
      // Add other ID types here
      default:
        throw new Error('Unsupported ID type');
    }

    // Save verification details
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO verified_ids (
          booking_id, id_type, id_number, name, dob, 
          verification_status, ocr_text
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          bookingId,
          idType,
          extractedInfo.idNumber,
          extractedInfo.name,
          extractedInfo.dob,
          'verified',
          result.data.text
        ],
        err => {
          if (err) reject(err);
          resolve();
        }
      );
    });

    // Update booking
    await new Promise((resolve, reject) => {
      db.run(
        'UPDATE bookings SET id_image_url = ?, verification_status = ? WHERE id = ?',
        [imageUrl, 'verified', bookingId],
        err => {
          if (err) reject(err);
          resolve();
        }
      );
    });

    return extractedInfo;

  } catch (error) {
    console.error('Error verifying ID:', error);
    throw error;
  }
}

module.exports = { verifyID };

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
    const namePattern = /([A-Z][A-Za-z\s]+)/;
    
    // DOB pattern: DD/MM/YYYY or YYYY
    const dobPattern = /(?:DOB|Year of Birth)[\s:]+([0-9]{2}\/[0-9]{2}\/[0-9]{4}|[0-9]{4})/i;

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

async function verifyID(imagePath, idType, bookingId, db) {
  try {
    console.log('Starting ID verification for:', { imagePath, idType, bookingId });
    
    if (!imagePath) {
      throw new Error('Image path is required');
    }

    try {
      await fs.access(imagePath);
    } catch (error) {
      throw new Error(`File not found at path: ${imagePath}`);
    }

    console.log('Processing image at path:', imagePath);

    // Perform OCR
    const result = await tesseract.recognize(imagePath, {
      lang: idType === 'aadhar' ? 'eng+hin' : 'eng'
    });

    console.log('OCR Result:', result.data.text);

    // Extract information based on ID type
    let extractedInfo;
    switch (idType.toLowerCase()) {
      case 'aadhar':
        extractedInfo = await AadhaarVerifier.extractInfo(result.data.text);
        break;
      // Add other ID types here
      default:
        throw new Error('Unsupported ID type: ' + idType);
    }

    // Validate extracted info
    if (!extractedInfo.name && !extractedInfo.idNumber) {
      throw new Error('Could not extract required information from ID');
    }

    // Save verification details
    await saveVerificationDetails(db, bookingId, idType, extractedInfo, imagePath);

    // Clean up temp file
    try {
      await fs.unlink(imagePath);
      console.log('Temporary file deleted:', imagePath);
    } catch (err) {
      console.error('Error deleting temp file:', err);
    }

    return extractedInfo;
  } catch (error) {
    console.error('Error in verifyID:', error);
    
    // Clean up temp file in case of error
    try {
      await fs.unlink(imagePath);
    } catch (err) {
      // Ignore deletion errors
    }
    
    throw error;
  }
}

async function saveVerificationDetails(db, bookingId, idType, info, imageUrl) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');

      try {
        // Insert verification details
        db.run(
          `INSERT INTO verified_ids (
            booking_id, id_type, id_number, name, dob, 
            verification_status, ocr_text
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            bookingId,
            idType,
            info.idNumber,
            info.name,
            info.dob,
            'verified',
            info.ocrText
          ]
        );

        // Update booking
        db.run(
          'UPDATE bookings SET id_image_url = ?, verification_status = ? WHERE id = ?',
          [imageUrl, 'verified', bookingId]
        );

        db.run('COMMIT', err => {
          if (err) reject(err);
          else resolve();
        });
      } catch (err) {
        db.run('ROLLBACK');
        reject(err);
      }
    });
  });
}

module.exports = { verifyID };

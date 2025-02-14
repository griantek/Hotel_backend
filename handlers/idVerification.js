const { PaddleOCR } = require('node-paddle-ocr');
const path = require('path');
const fsPromises = require('fs').promises;

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
  let fileExists = false;
  try {
    console.log('Starting ID verification for:', { imagePath, idType, bookingId });
    
    if (!imagePath) {
      throw new Error('Image path is required');
    }

    // File existence checks
    for (let i = 0; i < 3; i++) {
      try {
        await fsPromises.access(imagePath, fsPromises.constants.R_OK);
        const stats = await fsPromises.stat(imagePath);
        console.log('File verified as readable on attempt', i + 1, 'Size:', stats.size);
        fileExists = true;
        break;
      } catch (err) {
        console.log('File not accessible, attempt', i + 1, ':', err.message);
        if (i < 2) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    }

    if (!fileExists) {
      throw new Error(`File not found or not accessible at path: ${imagePath}`);
    }

    console.log('Processing image at path:', imagePath);

    // Initialize PaddleOCR
    const ocr = new PaddleOCR({
      modelPath: path.join(__dirname, '../models'), // Models will be downloaded here
      lang: 'en', // Use Hindi for Aadhar, English for others
      debug: false
    });

    try {
      // Perform OCR
      console.log('Starting OCR recognition...');
      const result = await ocr.recognize(imagePath);
      
      // Combine all text from detected regions
      const fullText = result.map(block => block.text).join('\n');
      console.log('OCR Result:', fullText);

      // Extract information based on ID type
      let extractedInfo;
      switch (idType.toLowerCase()) {
        case 'aadhar':
          extractedInfo = await AadhaarVerifier.extractInfo(fullText);
          break;
        default:
          throw new Error('Unsupported ID type: ' + idType);
      }

      // Validate extracted info
      if (!extractedInfo.name && !extractedInfo.idNumber) {
        throw new Error('Could not extract required information from ID');
      }

      // Save verification details
      await saveVerificationDetails(db, bookingId, idType, extractedInfo, imagePath);

      return extractedInfo;

    } catch (error) {
      console.error('Error in OCR processing:', error);
      throw error;
    }
  } catch (error) {
    console.error('Error in verifyID:', error);
    throw error;
  } finally {
    // Clean up temp file
    if (fileExists) {
      try {
        await fsPromises.unlink(imagePath);
        console.log('Temporary file deleted:', imagePath);
      } catch (err) {
        console.error('Error deleting temp file:', err);
      }
    }
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

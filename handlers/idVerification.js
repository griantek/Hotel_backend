const { createWorker } = require('tesseract.js');
const path = require('path');
const fsPromises = require('fs').promises;

function extractAadhaarInfo(text) {
    // Regex to extract the name (assuming the name follows a pattern like "Mohammed Rinshad P")
    const namePattern = /([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)/;
    const nameMatch = text.match(namePattern);
    const name = nameMatch ? nameMatch[0] : null;

    // Regex to extract the Aadhaar number (12-digit number, possibly spaced)
    const idPattern = /(\d{4}\s?\d{4}\s?\d{4})/;
    const idMatch = text.match(idPattern);
    const idNumber = idMatch ? idMatch[0].replace(/\s/g, "") : null; // Remove spaces

    return {
        Name: name,
        IDNumber: idNumber
    };
}

async function verifyID(imagePath, idType, bookingId, db) {
    let fileExists = false;
    try {
        console.log('Starting ID verification for:', { imagePath, idType, bookingId });

        if (!imagePath) {
            throw new Error('Image path is required');
        }

        // Check file exists with retry using promises
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

        const worker = await createWorker("eng");

        try {
            // Perform OCR
            console.log('Starting OCR recognition...');
            const { data: { text } } = await worker.recognize(imagePath);

            // Log the extracted text
            console.log('Extracted Text:', text);

            // Extract Aadhaar info
            const aadhaarInfo = extractAadhaarInfo(text);
            console.log('Extracted Aadhaar Info:', aadhaarInfo);

            return {
                success: true,
                text: text,
                aadhaarInfo: aadhaarInfo
            };

        } finally {
            // Terminate worker
            await worker.terminate();
            console.log('Tesseract worker terminated');
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

module.exports = { verifyID };
const tesseract = require('tesseract.js');
const path = require('path');
const fsPromises = require('fs').promises;

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

    // Read file contents
    const imageBuffer = await fsPromises.readFile(imagePath);
    
    // Initialize Tesseract worker
    const worker = await tesseract.createWorker();

    try {
      // Initialize worker with English only
      await worker.loadLanguage('eng');
      await worker.initialize('eng');

      // Perform OCR
      console.log('Starting OCR recognition...');
      const result = await worker.recognize(imageBuffer);
      
      // Just log the extracted text for now
      console.log('Extracted Text:', result.data.text);

      return {
        success: true,
        text: result.data.text
      };

    } finally {
      // Always terminate worker
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


const fs = require('fs');
const path = require('path');

// Create required directories
const dirs = [
    path.join(__dirname, 'uploads'),
    path.join(__dirname, 'uploads', 'temp'),
    path.join(__dirname, 'uploads', 'ids')
];

dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

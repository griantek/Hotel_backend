const fs = require('fs');
const path = require('path');

// Create required directories with proper permissions
const dirs = [
    path.join(__dirname, 'uploads'),
    path.join(__dirname, 'uploads', 'temp'),
    path.join(__dirname, 'uploads', 'ids')
];

// Set more permissive permissions for development
const dirMode = 0o777;  // Full permissions
const fileMode = 0o666;  // Read/write for all

async function initDirectories() {
    try {
        for (const dir of dirs) {
            try {
                await fs.promises.mkdir(dir, { recursive: true, mode: dirMode });
                await fs.promises.chmod(dir, dirMode);
                console.log(`Directory created/verified with permissions: ${dir}`);
            } catch (err) {
                console.error(`Error with directory ${dir}:`, err);
            }
        }

        // Set permissions for existing files
        for (const dir of dirs) {
            try {
                const files = await fs.promises.readdir(dir);
                for (const file of files) {
                    const filePath = path.join(dir, file);
                    await fs.promises.chmod(filePath, fileMode);
                    console.log(`Set permissions for file: ${filePath}`);
                }
            } catch (err) {
                console.error(`Error setting file permissions in ${dir}:`, err);
            }
        }
    } catch (err) {
        console.error('Error in initialization:', err);
    }
}

initDirectories().then(() => {
    console.log('Initialization complete');
}).catch(err => {
    console.error('Initialization failed:', err);
});

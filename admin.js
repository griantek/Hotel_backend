const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');

const db = new sqlite3.Database('hotel.db'); // Connect to your database
const saltRounds = 10;

const username = "admin";
const plainPassword = "1234";

bcrypt.hash(plainPassword, saltRounds, (err, hashedPassword) => {
    if (err) {
        console.error("Error hashing password:", err);
    } else {
        db.run(
            'INSERT INTO admins (username, password) VALUES (?, ?)', 
            [username, hashedPassword], 
            (err) => {
                if (err) {
                    console.error("Error inserting admin into database:", err);
                } else {
                    console.log("Admin created successfully!");
                }
                db.close(); // Close the database connection
            }
        );
    }
});
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse');

// Load environment variables for DB access
require('dotenv').config({ path: path.resolve(__dirname, '.env') }); 

// Import DB connection and Sequelize models
// NOTE: Ensure your config/db.js and models are accessible
const { Order } = require('./models'); 
const { sequelize } = require('./config/db');


/**
 * 1. Fetches all bill_number records from the 'orders' table in the database.
 * @returns {Set<string>} A Set containing all imported Bill Numbers.
 */
async function getImportedBillNumbersFromDB() {
    try {
        // NOTE: We don't call connectDB() here because the models loading usually 
        // handles the initial connection attempt. We use the sequelize object directly.
        
        const orders = await Order.findAll({
            attributes: ['bill_number'],
            raw: true, // Return plain objects instead of Sequelize instances
        });

        // Convert the result array of objects into a Set of Bill Number strings
        const importedBillNumbers = new Set(
            orders.map(order => order.bill_number.toString().trim())
        );

        return importedBillNumbers;

    } catch (error) {
        console.error("CRITICAL: Failed to fetch data from the database. Check connection and schema.", error);
        // If connection fails, return an empty set to allow CSV processing to run safely.
        return new Set();
    }
}


/**
 * 2. Performs Delta Analysis between a source CSV file and the database records.
 * @param {string} csvFilePath - Path to the CSV file.
 */
async function performDeltaAnalysis(csvFilePath) {
    if (!fs.existsSync(csvFilePath)) {
        console.error(`\nERROR: CSV file not found at path: ${csvFilePath}`);
        console.error("Please ensure the file is saved in the root project directory.");
        return;
    }

    // --- STEP 1: Fetch all Bill Numbers from the database
    const importedDbBills = await getImportedBillNumbersFromDB();
    if (importedDbBills.size === 0) {
        console.warn("\nWARNING: Database returned zero imported Bill Numbers. Analysis may be inaccurate.");
    }
    
    // --- STEP 2: Process CSV and perform set analysis ---
    const csvData = fs.readFileSync(csvFilePath, { encoding: 'utf8' });
    const csvBillNumbers = new Set();
    const result = {
        missingInDb: [],       // In CSV, not in DB. Needs importing.
        extraInDb: [],         // In DB, not in CSV. Manual or older data.
        matched: 0,
    };

    await new Promise((resolve, reject) => {
        parse(csvData, {
            columns: true, 
            skip_empty_lines: true,
            delimiter: ',',
            trim: true,
        }, (err, records) => {
            if (err) return reject(err);

            for (const record of records) {
                // IMPORTANT: Use the exact column name from your CSV file headers
                const billNumber = record['Invoice Number'] ? record['Invoice Number'].toString().trim() : null;

                if (billNumber) {
                    // Check for unique Bill Numbers within the CSV (since CSV has line items)
                    if (csvBillNumbers.has(billNumber)) continue;
                    csvBillNumbers.add(billNumber); 

                    // Check if the bill number exists in the DB set
                    if (importedDbBills.has(billNumber)) {
                        result.matched++;
                        importedDbBills.delete(billNumber); // Remove matched item from DB set
                    } else {
                        result.missingInDb.push(billNumber);
                    }
                }
            }
            resolve();
        });
    });
    
    // --- STEP 3: Identify Extra Data ---
    // Anything remaining in importedDbBills set is "Extra Data"
    result.extraInDb = Array.from(importedDbBills);

    // --- STEP 4: Output Results ---
    console.log("\n==============================================");
    console.log("         ORDER DATA RECONCILIATION");
    console.log("==============================================");
    console.log(`TOTAL UNIQUE ORDERS IN CSV: ${csvBillNumbers.size}`);
    console.log(`TOTAL ORDERS CURRENTLY IN DB: ${result.matched + result.extraInDb.length}`);
    console.log(`TOTAL ORDERS MATCHED: ${result.matched}`);


    console.log(`\n1. ❌ ORDERS MISSED/FAILED (${result.missingInDb.length})`);
    console.log("These Bill Numbers are in your CSV but NOT in the database. They need to be imported or re-checked:");
    if (result.missingInDb.length > 0) {
        console.log(result.missingInDb.join(', '));
    }


    console.log(`\n2. ➕ EXTRA DATA / MANUAL ENTRY (${result.extraInDb.length})`);
    console.log("These Bill Numbers are in the database but were NOT in this CSV. They are extra data (e.g., manual entry or older import):");
    if (result.extraInDb.length > 0) {
        console.log(result.extraInDb.join(', '));
    }

    console.log("\n--- Note on Skipped/Duplicated Orders ---");
    console.log("If an order was SKIPPED during import, its Bill Number will appear in the 'ORDERS MISSED/FAILED' list above.");
}

// --- EXECUTION ---
const csvFileName = 'wc-orders-report-export-17628076961787.csv';
const uploadedFilePath = path.join(__dirname, csvFileName);

// You must run this script from the terminal: node data_reconciliation.js
performDeltaAnalysis(uploadedFilePath).catch(error => {
    console.error("FATAL ERROR during reconciliation execution:", error);
    sequelize.close(); // Close connection on error
});
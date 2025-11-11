const express = require('express');
const multer = require('multer');
const fs = require('fs');
const cors = require('cors'); 
require('dotenv').config(); // Load environment variables first
const path = require('path');

const { connectDB } = require('./config/db');
// Explicitly import models to ensure Sequelize associations are set up
const models = require('./models'); 
const { processOrderFile } = require('./services/importService');
//const { generateSalesSummary } = require('./services/reportService');

// Add this import near the top of app.js
const { purgeAllData } = require('./services/purgeService');

// Add this import near the top of app.js
const { generateGstr1Report } = require('./services/gstr1Service');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Global Job Tracking and Upload Config ---
const jobStatus = {}; 
const uploadDir = process.env.UPLOAD_DIR || 'uploads/';

// Setup Multer storage for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // Ensure directory exists
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir);
        }
        cb(null, uploadDir); 
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ storage: storage });

// --- Middleware ---
// Enable CORS for frontend development (React will run on a different port, e.g., 5173 for Vite)
app.use(cors({ origin: 'http://localhost:5173' })); 

// --- Database Connection ---
connectDB(); 

// --- Routes ---

// 1. Start Import Job (POST)
app.post('/api/import-orders', upload.single('orderFile'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send({ message: 'No file uploaded.' });
    }

    const job_id = Date.now().toString();
    // Initialize job status
    jobStatus[job_id] = { 
        status: 'PENDING', 
        summary: { totalProcessed: 0, successfulInserts: 0, failedInserts: 0, skippedDuplicates: 0 } 
    };

    // Run the import process asynchronously (non-blocking)
    processOrderFile(req.file.path, jobStatus, job_id)
        .then(finalSummary => {
            jobStatus[job_id].status = 'COMPLETED';
            jobStatus[job_id].summary = finalSummary;
        })
        .catch(error => {
            jobStatus[job_id].status = 'FAILED';
            jobStatus[job_id].error = error.message;
            console.error(`Job ${job_id} failed:`, error);
        });

    // Immediately respond with the job ID (HTTP 202: Accepted)
    res.status(202).send({
        message: 'Import started successfully in the background.',
        job_id: job_id
    });
});

// 2. Get Import Status (GET)
app.get('/api/import-status/:jobId', (req, res) => {
    const status = jobStatus[req.params.jobId];
    if (!status) {
        return res.status(404).send({ message: 'Job ID not found.' });
    }
    // Return the current status and summary
    res.status(200).send(status);
});

// 3. Get Sales Report (GET)
app.get('/api/reports/sales', async (req, res) => {
    try {
        const report = await generateSalesSummary();
        res.status(200).send(report);
    } catch (error) {
        console.error('Failed to generate sales report:', error);
        res.status(500).send({ message: 'Failed to generate report.', error: error.message });
    }
});

// 4. Purge Data Endpoint (DELETE)
// Use DELETE method as it modifies/deletes server resources
app.delete('/api/purge-data', async (req, res) => {
    try {
        const result = await purgeAllData();
        if (result.success) {
            // HTTP 200 OK
            res.status(200).send({ message: result.message });
        } else {
            // HTTP 500 Internal Server Error (if the DB command failed)
            res.status(500).send({ message: result.message });
        }
    } catch (error) {
        console.error('Fatal purge error:', error);
        res.status(500).send({ message: 'A critical server error occurred during purge.' });
    }
});


// 4. GSTR-1 Export Endpoint (POST)
app.post('/api/reports/gstr1-export', express.json(), async (req, res) => {
    // Input body: { "startDate": "2025-10-01", "endDate": "2025-10-31" }
    const { startDate, endDate } = req.body; 

    if (!startDate || !endDate) {
        return res.status(400).send({ message: 'Missing required startDate or endDate.' });
    }

    try {
        // Trigger the service to fetch data, generate Excel, and save to disk
        const downloadPath = await generateGstr1Report(startDate, endDate);
        
        // Return the download link path
        res.status(200).send({
            message: 'GSTR-1 Report generated successfully.',
            downloadPath: downloadPath, // e.g., 'downloads/GNX-GSTR1-20251001-20251031.xlsx'
            downloadUrl: `${req.protocol}://${req.get('host')}/${downloadPath}`
        });

    } catch (error) {
        console.error('GSTR-1 Export Failed:', error);
        res.status(500).send({ message: 'Failed to generate GSTR-1 Report due to a server error.', error: error.message });
    }
});

// IMPORTANT: You must also add a static route to serve the downloads directory
app.use('/downloads', express.static(path.join(__dirname, 'downloads')));


app.listen(PORT, () => {
    console.log(`Server running on port ${PORT} in ${process.env.NODE_ENV} mode.`);
});
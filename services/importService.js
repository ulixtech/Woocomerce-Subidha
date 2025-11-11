const ExcelJS = require('exceljs');
const fs = require('fs');
const { sequelize } = require('../config/db');
// Import all four models
const { Customer, Order, OrderItem, Product } = require('../models'); 

// Map Excel Column Headers to Database/Model Keys
const COLUMN_MAP = {
    'Bill Number': 'bill_number',
    'Order Number': 'order_number',
    'Order Date': 'order_date',
    'Customer User ID': 'customer_user_id', 
    'Customer Username': 'customer_username', 
    'Party Name': 'party_name',
    'Company (Billing)': 'company_billing',
    'GST Number': 'gst_number',
    'State Name': 'state_name',
    'Address': 'address',
    'Pincode': 'pincode',
    'Country': 'country',
    'Email': 'email',
    'Phone': 'phone',
    'Item #': 'item_hash',
    'Product Id': 'product_id', 
    'Item Name': 'item_name', 
    'HSN Code': 'hsn_code',
    'GST Rate': 'gst_rate',
    'Quantity': 'quantity',
    'Item Cost': 'item_cost', 
    'Order Line Tax': 'order_line_tax',
    'Cart Discount Amount': 'cart_discount_amount',
    'Order Subtotal Amount': 'order_subtotal_amount',
    'Order Total Tax Amount': 'order_total_tax_amount',
    'Order Total Amount': 'order_total_amount',
    'Payment Method': 'payment_method',
    'Transaction ID': 'transaction_id',
};


/**
 * Reads and transforms the XLSX data into a structured format for insertion.
 */
async function parseFileAndGroupOrders(filePath) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const worksheet = workbook.getWorksheet(1); 

    const headerRow = worksheet.getRow(1);
    const headers = headerRow ? headerRow.values.map(v => v ? v.toString().trim() : null) : [];

    const ordersMap = new Map();

    worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1 || row.hasValues === false) return; 

        const rowData = {};
        row.eachCell((cell, colNumber) => {
            const headerKey = headers[colNumber];
            if (headerKey && COLUMN_MAP[headerKey]) {
                const dbKey = COLUMN_MAP[headerKey];
                
                let cellValue = cell.value;
                if (cellValue && typeof cellValue === 'object' && cellValue.result !== undefined) {
                    cellValue = cellValue.result;
                }
                rowData[dbKey] = cellValue;
            }
        });

        const billNumber = rowData.bill_number;
        if (!billNumber || !rowData.order_total_amount) {
            console.warn(`Skipping row ${rowNumber}: Missing critical data (Bill Number or Total Amount).`);
            return;
        }

        if (!ordersMap.has(billNumber)) {
            ordersMap.set(billNumber, {
                ...rowData, 
                items: [], 
            });
        }
        
        ordersMap.get(billNumber).items.push({
            // Use Product Id, fall back to Item #
            product_id: rowData.product_id || rowData.item_hash, 
            item_hash: rowData.item_hash,
            item_name: rowData.item_name,
            hsn_code: rowData.hsn_code,
            gst_rate: rowData.gst_rate,
            quantity: rowData.quantity,
            unit_cost_at_sale: rowData.item_cost, 
            order_line_tax: rowData.order_line_tax,
        });
    });

    return Array.from(ordersMap.values());
}
// Function to normalize a phone number for consistent lookup and storage
function normalizePhone(phoneNumber) {
    if (!phoneNumber) return '';
    // Remove all non-digit characters (including spaces, dashes, parentheses)
    let cleaned = phoneNumber.replace(/\D/g, ''); 
    
    // If it starts with a country code (like 91), strip it for base comparison 
    // or ensure consistent formatting for storage.
    // For simplicity, we'll keep it clean unless you specify a storage format.
    // Let's ensure it's just the digits used for merging logic:
    if (cleaned.startsWith('91') && cleaned.length > 10) {
        cleaned = cleaned.substring(2);
    }
    
    return cleaned;
}
// --- HELPER FUNCTION: Handle Customer Merging (Primary: Phone, Secondary: Email) ---
async function findOrCreateCustomer(orderData, t) {
    const phone = normalizePhone(orderData.phone);
    const email = (orderData.email || '').toString().trim();
    let customer = null;
    let customerUpdateFields = {};

    // 1. PRIMARY SEARCH: By Phone Number (Checking 'all_phones' JSON array)
    if (phone) {
        // Use JSON_CONTAINS for MySQL JSON array search
        customer = await Customer.findOne({
            where: sequelize.literal(`JSON_CONTAINS(all_phones, '"${phone}"')`),
            transaction: t,
        });
    }

    // 2. SECONDARY SEARCH: By Email (Only if not found by phone and email is available)
    if (!customer && email) {
        customer = await Customer.findOne({
            where: { email: email },
            transaction: t,
        });
    }

    // --- Customer Found: Merge Details ---
    if (customer) {
        // FIX: Explicitly parse JSON string from DB before using array methods
        let phones = (customer.all_phones && typeof customer.all_phones === 'string') ? JSON.parse(customer.all_phones) : customer.all_phones || [];
        let emails = (customer.all_emails && typeof customer.all_emails === 'string') ? JSON.parse(customer.all_emails) : customer.all_emails || [];
        
        let shouldUpdate = false;

        // Merge new phone
        if (phone && !phones.includes(phone)) {
            phones.push(phone);
            customerUpdateFields.all_phones = JSON.stringify(phones); // FIX: Stringify back for database save
            shouldUpdate = true;
        }
        // Merge new email
        if (email && !emails.includes(email)) {
            emails.push(email);
            customerUpdateFields.all_emails = JSON.stringify(emails); // FIX: Stringify back for database save
            shouldUpdate = true;
        }
        
        // Update non-unique fields to the latest data
        customerUpdateFields = {
            ...customerUpdateFields,
            party_name: orderData.party_name || customer.party_name,
            company_billing: orderData.company_billing || customer.company_billing,
            gst_number: orderData.gst_number || customer.gst_number,
            address: orderData.address || customer.address,
            pincode: orderData.pincode || customer.pincode,
            state_name: orderData.state_name || customer.state_name,
            customer_user_id: orderData.customer_user_id || customer.customer_user_id,
            customer_username: orderData.customer_username || customer.customer_username,
        };
        
        if (shouldUpdate || Object.keys(customerUpdateFields).length > 0) {
            await customer.update(customerUpdateFields, { transaction: t });
        }
    } 
    
    // --- Customer Not Found: Create New Profile ---
    else {
        // We MUST have an email to create a profile because it's the unique key in the model
        if (!email) {
            throw new Error(`Missing primary unique key (Email) for new customer creation from party: ${orderData.party_name}`);
        }

        const newCustomerData = {
            customer_user_id: orderData.customer_user_id,
            customer_username: orderData.customer_username,
            email: email, // This is the primary unique key
            party_name: orderData.party_name || 'N/A',
            company_billing: orderData.company_billing || 'N/A',
            gst_number: orderData.gst_number,
            address: orderData.address || 'N/A',
            pincode: orderData.pincode || 'N/A',
            country: orderData.country || 'N/A',
            state_name: orderData.state_name || 'N/A',
            // FIX: Store phone/email as JSON string arrays for the database
            all_phones: JSON.stringify(phone ? [phone] : []),
            all_emails: JSON.stringify(email ? [email] : []),
        };
        customer = await Customer.create(newCustomerData, { transaction: t });
    }

    return customer;
}

// --- HELPER FUNCTION: Handle Product Master Lookup/Creation ---
async function findOrCreateProduct(itemData, t) {
    const masterProductId = itemData.product_id;
    
    if (!masterProductId) {
        throw new Error(`Product Id/Item # is missing for item: ${itemData.item_name}`);
    }

    // 1. Search by master product ID
    let product = await Product.findOne({
        where: { product_id: masterProductId },
        transaction: t,
    });

    // 2. If not found, create new master product record
    if (!product) {
        product = await Product.create({
            product_id: masterProductId,
            item_name: itemData.item_name || 'Unknown Product',
            hsn_code: itemData.hsn_code,
        }, { transaction: t });
    }
    
    return product;
}

/**
 * Main function to process the file and insert data transactionally.
 * @param {string} filePath - Path to the uploaded XLSX file.
 * @param {object} jobStatus - Global object reference to update progress.
 * @param {string} jobId - The ID of the current job.
 * @returns {object} Summary of import results.
 */
async function processOrderFile(filePath, jobStatus, jobId) {
    const groupedOrders = await parseFileAndGroupOrders(filePath);

    // Update total processed count for the job (for frontend progress bar)
    jobStatus[jobId].summary.totalProcessed = groupedOrders.length; 

    let successfulInserts = 0;
    let skippedDuplicates = 0;
    let failedInserts = 0;

    for (const orderData of groupedOrders) {
        // Use a transaction to ensure atomicity
        const t = await sequelize.transaction();
        
        try {
            // 1. FIND or CREATE and MERGE CUSTOMER PROFILE
            const customer = await findOrCreateCustomer(orderData, t);

            // 2. ORDER INSERTION - Check for duplication
            const existingOrder = await Order.findOne({ 
                where: { bill_number: orderData.bill_number }, 
                transaction: t 
            });

            if (existingOrder) {
                // If exists, skip and roll back this transaction
                await t.rollback();
                skippedDuplicates++;
                jobStatus[jobId].summary.skippedDuplicates = skippedDuplicates;
                continue; 
            }

            const orderToInsert = {
                bill_number: orderData.bill_number,
                order_number: orderData.order_number,
                order_date: orderData.order_date ? new Date(orderData.order_date) : new Date(), 
                cart_discount_amount: parseFloat(orderData.cart_discount_amount) || 0.00,
                order_subtotal_amount: parseFloat(orderData.order_subtotal_amount) || 0.00,
                order_total_tax_amount: parseFloat(orderData.order_total_tax_amount) || 0.00,
                order_total_amount: parseFloat(orderData.order_total_amount) || 0.00,
                payment_method: orderData.payment_method,
                transaction_id: orderData.transaction_id,
                customerId: customer.id, 
            };
            
            const newOrder = await Order.create(orderToInsert, { transaction: t });

            // 3. ORDER ITEMS INSERTION
            
            const itemsToInsert = [];
            for (const itemData of orderData.items) {
                // a. Find or Create Product Master
                const product = await findOrCreateProduct(itemData, t);
                
                // b. Prepare OrderItem data
                itemsToInsert.push({
                    item_hash: itemData.item_hash || itemData.product_id || 'N/A',
                    quantity: parseInt(itemData.quantity) || 0,
                    unit_cost_at_sale: parseFloat(itemData.unit_cost_at_sale) || 0.00,
                    gst_rate: parseFloat(itemData.gst_rate) || 0.00,
                    order_line_tax: parseFloat(itemData.order_line_tax) || 0.00,
                    orderId: newOrder.id, // Link to the new Order
                    productId: product.id, // Link to the Master Product
                });
            }

            if (itemsToInsert.length > 0) {
                await OrderItem.bulkCreate(itemsToInsert, { transaction: t });
            }

            // Commit the transaction
            await t.commit();
            successfulInserts++;
            jobStatus[jobId].summary.successfulInserts = successfulInserts; 

        } catch (error) {
            // If any step failed, roll back the transaction
            await t.rollback();
            failedInserts++;
            jobStatus[jobId].summary.failedInserts = failedInserts; 
            console.error(`Failed to import order ${orderData.bill_number}:`, error.message);
        }
    }

    // 4. Clean up the uploaded file
    fs.unlink(filePath, (err) => {
        if (err) console.error('Error deleting file:', err);
    });

    // Return final summary
    return jobStatus[jobId].summary;
}

module.exports = { processOrderFile };